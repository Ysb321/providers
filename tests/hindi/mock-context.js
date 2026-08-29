/**
 * A ProviderContext whose `axios`/`fetch` replay the captured MoviesDrive and
 * HDHub4u responses, plus realistic HubCloud/GDFlix pages.
 *
 * The shared extractors are inlined into the built bundles by esbuild, so they
 * cannot be stubbed at the module level. Instead the transport serves the same
 * markup those hosts really return, which means the genuine extractor code
 * runs end to end - a stronger test than replacing it.
 */
const cheerio = require("cheerio");
const F = require("./fixtures");

function makeKvStore(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    get: async (k) => store.get(k),
    set: async (k, v) => void store.set(k, v),
    delete: async (k) => store.delete(k),
    keys: async () => Array.from(store.keys()),
    clear: async () => store.clear(),
  };
}

const ok = (data, headers) => ({ status: 200, data, headers: headers || {} });

/**
 * A HubCloud drive page. The real one exposes the "Generate Direct Download
 * Link" target as `var url = '...'` in an inline script, which is what
 * `extractUrlFromScript` in the shared extractor reads.
 */
function hubcloudDrivePage(id) {
  return `<!doctype html><html><body>
    <div>The.Title.2026.720p.WEB-DL.Hindi.mkv - File Size 1.12 GB</div>
    <script>var url = 'https://gamerxyt.com/hubcloud.php?host=hubcloud&id=${id}&token=dGVzdA==';</script>
    <a class="fa-file-download fa-lg" href="https://gamerxyt.com/hubcloud.php?host=hubcloud&id=${id}&token=dGVzdA=="></a>
    <a href="https://gamerxyt.com/hubcloud.php?host=hubcloud&id=${id}&token=dGVzdA==">Generate Direct Download Link</a>
  </body></html>`;
}

/**
 * The gamerxyt "links generated" page. Button classes match what the real
 * extractor selects (.btn-success.btn-lg.h6 / .btn-danger / .btn-secondary).
 */
function hubcloudLinksPage(id) {
  return `<!doctype html><html><body>
    <a class="btn btn-success btn-lg h6" href="https://f84f84ad.r2.cloudflarestorage.com/hub/${id}?X-Amz-Signature=abc123&response-content-disposition=attachment%3B%20filename%3D%22Title.720p.mkv%22">Download [FSL Server]</a>
    <a class="btn btn-danger" href="https://pixeldrain.dev/u/ga6rMMPA">Download [PixelServer : 2]</a>
    <a class="btn btn-secondary" href="https://workers-cf.dev/file/${id}">Download [Server : 10Gbps]</a>
  </body></html>`;
}

/** A GDFlix file page with its instant/cloud mirrors. */
function gdflixFilePage(id) {
  return `<!doctype html><html><body>
    <ul><li>Name : The.Title.2026.720p.WEB-DL.Hindi.mkv</li><li>Size : 1.12GB</li></ul>
    <a href="https://instant.busycdn.xyz/${id}?bytes=1202555782">Instant DL [10GBPS]</a>
    <a href="https://pub-eee777ee.r2.dev/${id}?token=1788003798">CLOUD DOWNLOAD [R2]</a>
  </body></html>`;
}

/**
 * @param {object} opts
 * @param {boolean} [opts.mirrorDown]      primary domain is DNS-blocked
 * @param {boolean} [opts.hubcloudDead]    HubCloud pages 404
 * @param {boolean} [opts.allHostsDead]    every file host 404s
 * @param {object}  [opts.settings]        seed kvStore
 */
function createContext(opts = {}) {
  const calls = [];

  function route(url) {
    // Simulated ISP block on the primary domain, to exercise mirror failover.
    if (
      opts.mirrorDown &&
      (url.startsWith("https://new3.moviesdrive.christmas") ||
        url.startsWith("https://new5.hdhub4u.cl"))
    ) {
      throw new Error("ENOTFOUND (simulated ISP block)");
    }

    /* ---------------- MoviesDrive ---------------- */
    if (/moviesdrive|moviesdrives|moviedrive/i.test(url)) {
      if (url.includes("/search.php")) return ok(F.MD_SEARCH_JSON);
      if (/reacher-season/i.test(url)) return ok(F.MD_SERIES_HTML);
      if (/the-whisper-man|awarapan/i.test(url)) return ok(F.MD_MOVIE_HTML);
      return ok(F.MD_LIST_HTML);
    }
    if (/mdrive\.lol/i.test(url)) {
      if (/\/(15688|15691|6785|6759)\b/.test(url)) {
        return ok(F.MD_ARCHIVE_SERIES_HTML);
      }
      return ok(F.MD_ARCHIVE_MOVIE_HTML);
    }

    /* ---------------- HDHub4u ---------------- */
    if (/hdhub4u/i.test(url)) {
      // The brand's "official" domains are SEO landing pages: HTTP 200, real
      // HTML, zero catalogue. Serve that so the landing-page guard is tested.
      if (/hdhub4u\.(bi|ec|ms|tv|download)/i.test(url)) {
        return ok(F.HH_LANDING_HTML);
      }
      if (/mousetrap|season/i.test(url)) return ok(F.HH_SERIES_HTML);
      if (/the-whisper-man|alpha-2026/i.test(url)) return ok(F.HH_MOVIE_HTML);
      return ok(F.HH_LIST_HTML);
    }
    if (/hubdrive\.tips/i.test(url)) {
      if (opts.allHostsDead) return { status: 404, data: "", headers: {} };
      return ok(F.HH_HUBDRIVE_HTML);
    }

    /* ---------------- file hosts ---------------- */
    if (/gamerxyt\.com/i.test(url)) {
      const id = (/id=([^&]+)/.exec(url) || [])[1] || "x";
      return ok(hubcloudLinksPage(id));
    }
    if (/hubcloud\.[a-z]+\/drive\//i.test(url)) {
      if (opts.hubcloudDead || opts.allHostsDead) {
        return { status: 404, data: "Not Found", headers: {} };
      }
      const id = url.split("/").pop();
      return ok(hubcloudDrivePage(id));
    }
    if (/hubcdn\.sbs/i.test(url)) {
      if (opts.allHostsDead) return { status: 404, data: "", headers: {} };
      const id = url.split("/").pop();
      return ok(hubcloudDrivePage(id));
    }
    if (/gdflix|gdlink/i.test(url)) {
      if (opts.allHostsDead) return { status: 404, data: "", headers: {} };
      const id = url.split("/").pop();
      return ok(gdflixFilePage(id));
    }

    return { status: 404, data: "Not Found", headers: {} };
  }

  async function get(url, config = {}) {
    calls.push({ method: "GET", url, config });
    const res = route(url);
    // Mirror axios: throw on 4xx unless the caller widened validateStatus.
    const validate = config.validateStatus;
    if (res.status >= 400 && !(validate && validate(res.status))) {
      const err = new Error(`Request failed with status code ${res.status}`);
      err.response = { status: res.status, data: res.data };
      throw err;
    }
    return res;
  }

  async function post(url, body, config = {}) {
    calls.push({ method: "POST", url, body, config });
    return { status: 404, data: "", headers: {} };
  }

  async function head(url, config = {}) {
    calls.push({ method: "HEAD", url, config });
    return { status: 200, data: "", headers: {} };
  }

  // The extractors call axios both as a function and as axios.get.
  const axios = Object.assign(
    (url, config) => get(url, config || {}),
    { get, post, head },
  );

  return {
    context: {
      axios,
      cheerio,
      commonHeaders: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
      },
      openWebView: async () => {
        throw new Error("WebView not available in tests");
      },
      kvStore: makeKvStore(opts.settings),
    },
    calls,
  };
}

/**
 * The hubcloud extractor falls back to global fetch for some hops. Point it at
 * the same routing table so tests never touch the network.
 */
function installFetchStub(opts = {}) {
  const original = global.fetch;
  const { context } = createContext(opts);
  global.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url;
    try {
      const res = await context.axios.get(url, {
        ...init,
        validateStatus: () => true,
      });
      const body = typeof res.data === "string" ? res.data : "";
      return {
        ok: res.status < 400,
        status: res.status,
        statusText: "",
        url,
        headers: { get: () => null },
        text: async () => body,
        json: async () => (typeof res.data === "object" ? res.data : {}),
      };
    } catch {
      return {
        ok: false,
        status: 599,
        statusText: "network",
        url,
        headers: { get: () => null },
        text: async () => "",
        json: async () => ({}),
      };
    }
  };
  return () => {
    global.fetch = original;
  };
}

module.exports = { createContext, installFetchStub };
