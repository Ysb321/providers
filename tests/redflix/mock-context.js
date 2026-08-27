/**
 * A ProviderContext whose `axios` replays the captured Redflix / TMDB-mirror /
 * Videasy / VidFast responses instead of hitting the network.
 */
const cheerio = require("cheerio");
const F = require("./fixtures");

function makeKvStore(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
    delete: async (key) => store.delete(key),
    keys: async () => Array.from(store.keys()),
    clear: async () => store.clear(),
  };
}

function ok(data, headers) {
  return { status: 200, data, headers: headers || {} };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.seedInvalid]     Videasy seed rejected
 * @param {boolean} [opts.videasyDown]     Videasy backend unreachable
 * @param {boolean} [opts.vidfastDown]     VidFast unreachable
 * @param {boolean} [opts.deadStreams]     every media URL 404s
 * @param {boolean} [opts.emptyManifest]   manifests parse but carry nothing
 * @param {boolean} [opts.siteSearchEmpty] /browse returns no hits
 * @param {boolean} [opts.siteDown]        redflix.club unreachable
 * @param {object}  [opts.settings]        seed kvStore
 */
function createContext(opts = {}) {
  const calls = [];

  async function get(url, config = {}) {
    calls.push({ method: "GET", url, config });

    /* ---------- redflix.club pages ---------- */
    if (url.includes("/browse?q=")) {
      if (opts.siteDown) throw new Error("ENOTFOUND redflix.club");
      return ok(opts.siteSearchEmpty ? F.BROWSE_HTML_EMPTY : F.BROWSE_HTML);
    }

    /* ---------- TMDB mirror ---------- */
    if (url.includes("db.speedracelight.com")) {
      if (url.includes("/trending/")) return ok(F.TRENDING);
      if (url.includes("/search/multi")) return ok(F.SEARCH_MULTI);

      // Episode existence probe must be checked before the season route.
      const epMatch = /\/tv\/(\d+)\/season\/(\d+)\/episode\/(\d+)/.exec(url);
      if (epMatch) {
        const season = Number(epMatch[2]);
        const episode = Number(epMatch[3]);
        const known = (F.SEASON_3.episodes || []).some(
          (e) => e.season_number === season && e.episode_number === episode,
        );
        if (season === 3 && known) return ok(F.EPISODE_S3E7);
        if (season === 1 && episode === 1) {
          return ok({ season_number: 1, episode_number: 1, name: "Pilot" });
        }
        return { status: 404, data: F.EPISODE_NOT_FOUND, headers: {} };
      }

      if (/\/tv\/\d+\/season\/\d+/.test(url)) return ok(F.SEASON_3);
      if (/\/tv\/\d+/.test(url)) return ok(F.TV_DETAIL);
      if (/\/movie\/\d+/.test(url)) return ok(F.MOVIE_DETAIL);
      if (url.includes("/tv/popular") || url.includes("/tv/top_rated")) {
        return ok(F.POPULAR_TV);
      }
      if (url.includes("/discover/tv")) return ok(F.POPULAR_TV);
      return ok(F.POPULAR_MOVIE);
    }

    /* ---------- Videasy ---------- */
    if (url.includes("api.speedracelight.com/seed")) {
      if (opts.videasyDown) throw new Error("ECONNREFUSED");
      return ok(F.SEED);
    }
    if (url.includes("sources-with-title")) {
      if (opts.videasyDown) throw new Error("ECONNREFUSED");
      if (opts.seedInvalid) return ok(F.SEED_INVALID);
      return ok(F.VIDEASY_ENCRYPTED);
    }

    /* ---------- VidFast ---------- */
    if (url.includes("vidfast.vc/")) {
      if (opts.vidfastDown) throw new Error("ECONNREFUSED");
      return ok(F.VIDFAST_PAGE_HTML);
    }
    if (url.includes("/enc-vidfast")) {
      if (opts.vidfastDown) throw new Error("ECONNREFUSED");
      return ok(F.VIDFAST_ENC);
    }

    /* ---------- media probes (verifyPlayable) ---------- */
    if (url.includes(".m3u8")) {
      if (opts.deadStreams || url.includes("/dead/")) {
        return { status: 404, data: "Not Found", headers: {} };
      }
      if (opts.emptyManifest) return ok(F.EMPTY_M3U8);
      return ok(url.includes("master") ? F.MASTER_M3U8 : F.MEDIA_M3U8, {
        "content-type": "application/vnd.apple.mpegurl",
      });
    }
    if (url.includes(".mp4")) {
      if (opts.deadStreams) return { status: 404, data: "", headers: {} };
      return {
        status: 206,
        data: Buffer.alloc(16),
        headers: { "content-type": "video/mp4" },
      };
    }

    return { status: 404, data: "Not Found", headers: {} };
  }

  async function post(url, body, config = {}) {
    calls.push({ method: "POST", url, body, config });

    if (url.includes("/dec-videasy")) {
      const isHdmovie = String(config.__server || "").includes("hdmovie");
      return ok(isHdmovie ? F.VIDEASY_DECRYPTED_HDMOVIE : F.VIDEASY_DECRYPTED);
    }
    if (url.includes("/dec-vidfast")) {
      const text = (body && body.text) || "";
      if (text.startsWith("b2c4")) return ok(F.VIDFAST_SERVERS_DECRYPTED);
      return ok(
        opts.deadStreams ? F.VIDFAST_STREAM_DEAD : F.VIDFAST_STREAM_DECRYPTED,
      );
    }
    // VidFast servers / stream endpoints are POSTs that return ciphertext.
    if (url.includes("/servers")) return ok(F.VIDFAST_SERVERS_ENCRYPTED);
    if (url.includes("vidfast.vc/")) return ok(F.VIDFAST_STREAM_ENCRYPTED);

    return { status: 404, data: "", headers: {} };
  }

  return {
    context: {
      axios: { get, post },
      cheerio,
      commonHeaders: {},
      openWebView: async () => {
        throw new Error("WebView not available in tests");
      },
      kvStore: makeKvStore(opts.settings),
    },
    calls,
  };
}

module.exports = { createContext };
