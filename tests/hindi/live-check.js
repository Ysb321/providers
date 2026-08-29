/**
 * Live smoke test for the Hindi providers.
 *
 *   npm run test:hindi:live
 *   npm run test:hindi:live -- moviesDrive          # one provider
 *   npm run test:hindi:live -- moviesDrive "Jawan"  # one title
 *
 * Hits the real sites and, for each of several different titles, walks
 * search -> meta -> (episodes) -> stream and probes the final link with a
 * ranged GET to confirm it serves actual media rather than an HTML error page.
 *
 * Needs outbound access to the sites and their file hosts, so it is a manual
 * tool rather than part of the default suite.
 */
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const rootDir = path.join(__dirname, "..", "..");
const load = (provider, mod) =>
  require(path.join(rootDir, "dist", provider, mod));

/** A deliberately varied set: dual-audio, Hindi-only, South dub, and series. */
const TITLES = {
  moviesDrive: [
    "The Whisper Man",
    "Jawan",
    "Awarapan 2",
    "Reacher",
    "Toxic",
  ],
  hdhub4u: [
    "The Whisper Man",
    "Alpha",
    "Bandar",
    "Mousetrap",
    "Anbe Diana",
    // Back-catalogue titles that are nowhere near the front page: these are
    // the ones that silently returned homepage entries while search was
    // going through the ignored `?s=` parameter.
    "Deadpool",
    "Deadpool & Wolverine",
  ],
};

function makeContext() {
  const store = new Map();
  return {
    axios,
    cheerio,
    commonHeaders: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    openWebView: async () => {
      throw new Error("no WebView outside the app");
    },
    kvStore: {
      get: async (k) => store.get(k),
      set: async (k, v) => void store.set(k, v),
      delete: async (k) => store.delete(k),
      keys: async () => Array.from(store.keys()),
      clear: async () => store.clear(),
    },
  };
}

const signal = new AbortController().signal;

/** Confirms a link really serves media. */
async function probe(stream) {
  try {
    const res = await axios.get(stream.link, {
      headers: Object.assign({ Range: "bytes=0-2047" }, stream.headers || {}),
      timeout: 25000,
      responseType: "arraybuffer",
      maxRedirects: 5,
      validateStatus: () => true,
    });
    if (res.status >= 400) return `HTTP ${res.status}`;
    const type = String(res.headers["content-type"] || "").toLowerCase();
    if (type.includes("text/html")) return "HTML (error/interstitial page)";
    const len = res.headers["content-length"] || "?";
    return `ok (${res.status}, ${type || "no content-type"}, ${len} bytes)`;
  } catch (err) {
    return `error: ${err.message}`;
  }
}

async function runTitle(provider, mods, query) {
  console.log(`\n${"=".repeat(66)}\n${provider} :: "${query}"\n${"=".repeat(66)}`);

  let results = [];
  try {
    results = await mods.posts.getSearchPosts({
      searchQuery: query,
      page: 1,
      providerValue: provider,
      signal,
      providerContext: makeContext(),
    });
  } catch (err) {
    console.log(`  search FAILED: ${err.message}`);
    return { query, ok: false, stage: "search" };
  }

  console.log(`  search: ${results.length} result(s)`);
  if (!results.length) return { query, ok: false, stage: "search" };
  results.slice(0, 3).forEach((r) => console.log(`    - ${r.title}`));

  const post = results[0];
  let info;
  try {
    info = await mods.meta.getMeta({
      link: post.link,
      providerContext: makeContext(),
    });
  } catch (err) {
    console.log(`  meta FAILED: ${err.message}`);
    return { query, ok: false, stage: "meta" };
  }

  console.log(
    `  meta: "${info.title}" [${info.type}] imdb=${info.imdbId || "-"} ` +
      `rows=${info.linkList.length}`,
  );

  // Pick something playable: a direct link, or expand a season.
  let playLink = "";
  let label = "";
  const direct = info.linkList.find((l) => (l.directLinks || []).length);
  if (direct) {
    playLink = direct.directLinks[0].link;
    label = `${direct.title} / ${direct.directLinks[0].title}`;
  } else {
    const season = info.linkList.find((l) => l.episodesLink);
    if (season && mods.episodes) {
      try {
        const eps = await mods.episodes.getEpisodes({
          url: season.episodesLink,
          providerContext: makeContext(),
        });
        console.log(`  episodes(${season.title}): ${eps.length}`);
        if (eps.length) {
          playLink = eps[0].link;
          label = `${season.title} / ${eps[0].title}`;
        }
      } catch (err) {
        console.log(`  episodes FAILED: ${err.message}`);
      }
    }
  }

  if (!playLink) {
    console.log("  no playable link found");
    return { query, ok: false, stage: "link" };
  }

  console.log(`  play: ${label}`);
  let streams = [];
  try {
    streams = await mods.stream.getStream({
      link: playLink,
      type: info.type === "series" ? "series" : "movie",
      signal,
      providerContext: makeContext(),
    });
  } catch (err) {
    console.log(`  stream FAILED: ${err.message}`);
    return { query, ok: false, stage: "stream" };
  }

  console.log(`  streams: ${streams.length}`);
  let playable = false;
  for (const s of streams.slice(0, 3)) {
    const verdict = await probe(s);
    if (verdict.startsWith("ok")) playable = true;
    console.log(`    [${s.quality || "?"}] ${s.server}`);
    console.log(`      ${s.link.slice(0, 100)}`);
    console.log(`      probe: ${verdict}`);
  }

  return { query, ok: playable, stage: playable ? "done" : "probe" };
}

(async () => {
  const [onlyProvider, onlyTitle] = process.argv.slice(2);

  const providers = {
    moviesDrive: {
      posts: load("moviesDrive", "posts.js"),
      meta: load("moviesDrive", "meta.js"),
      episodes: load("moviesDrive", "episodes.js"),
      stream: load("moviesDrive", "stream.js"),
    },
    hdhub4u: {
      posts: load("hdhub4u", "posts.js"),
      meta: load("hdhub4u", "meta.js"),
      episodes: null,
      stream: load("hdhub4u", "stream.js"),
    },
  };

  const summary = [];
  for (const [name, mods] of Object.entries(providers)) {
    if (onlyProvider && name !== onlyProvider) continue;
    const titles = onlyTitle ? [onlyTitle] : TITLES[name];
    for (const title of titles) {
      const result = await runTitle(name, mods, title);
      summary.push({ provider: name, ...result });
    }
  }

  console.log(`\n${"=".repeat(66)}\nSUMMARY\n${"=".repeat(66)}`);
  for (const row of summary) {
    console.log(
      `  ${row.ok ? "PASS" : "FAIL"}  ${row.provider.padEnd(12)} ${String(
        row.query,
      ).padEnd(20)} ${row.ok ? "" : `(stopped at: ${row.stage})`}`,
    );
  }
  const passed = summary.filter((r) => r.ok).length;
  console.log(`\n  ${passed}/${summary.length} titles played end to end`);
})();
