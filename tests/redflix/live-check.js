/**
 * Live smoke test for the redflix provider.
 *
 *   npm run test:redflix:live
 *
 * Unlike run.js (which replays captured fixtures) this hits the real backends.
 * It needs outbound access to redflix.club, db.speedracelight.com,
 * api.speedracelight.com, vidfast.vc and enc-dec.app, so it is a manual tool
 * rather than part of the default suite.
 *
 * For each title it reports whether the returned links actually serve media,
 * and for series whether a deep episode resolves to its own distinct file.
 */
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const rootDir = path.join(__dirname, "..", "..");
const load = (mod) => require(path.join(rootDir, "dist", "redflix", mod));

const posts = load("posts.js");
const meta = load("meta.js");
const episodes = load("episodes.js");
const stream = load("stream.js");

function makeContext() {
  const store = new Map();
  return {
    axios,
    cheerio,
    commonHeaders: {},
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
async function probe(s) {
  try {
    if (s.type === "m3u8") {
      const res = await axios.get(s.link, {
        headers: s.headers,
        timeout: 20000,
        validateStatus: () => true,
      });
      if (res.status >= 400) return `HTTP ${res.status}`;
      const body = typeof res.data === "string" ? res.data : "";
      if (!body.includes("#EXTM3U")) return "not a manifest";
      const variants = (body.match(/#EXT-X-STREAM-INF/g) || []).length;
      const segments = (body.match(/#EXTINF/g) || []).length;
      if (!variants && !segments) return "EMPTY manifest";
      return `ok (${variants} variants, ${segments} segments)`;
    }
    const res = await axios.get(s.link, {
      headers: Object.assign({ Range: "bytes=0-1023" }, s.headers),
      timeout: 20000,
      responseType: "arraybuffer",
      validateStatus: () => true,
    });
    if (res.status >= 400) return `HTTP ${res.status}`;
    const ct = String(res.headers["content-type"] || "");
    if (ct.includes("text/html")) return "HTML (error page)";
    return `ok (${res.status}, ${ct})`;
  } catch (err) {
    return `error: ${err.message}`;
  }
}

async function report(label, link, type) {
  console.log(`\n--- ${label}`);
  try {
    const streams = await stream.getStream({
      link,
      type,
      signal,
      providerContext: makeContext(),
    });
    console.log(`    ${streams.length} stream(s)`);
    const seen = [];
    for (const s of streams.slice(0, 4)) {
      console.log(`      [${s.type} ${s.quality || "?"}] ${s.server}`);
      console.log(`        ${s.link.slice(0, 110)}`);
      console.log(`        probe: ${await probe(s)}`);
      seen.push(s.link);
    }
    return seen;
  } catch (err) {
    console.log(`    no stream: ${err.message}`);
    return [];
  }
}

(async () => {
  console.log("=== catalogue");
  for (const filter of ["all|trending", "movie|popular", "tv|popular"]) {
    try {
      const list = await posts.getPosts({
        filter,
        page: 1,
        providerValue: "redflix",
        signal,
        providerContext: makeContext(),
      });
      console.log(`  ${filter}: ${list.length} post(s)`);
    } catch (err) {
      console.log(`  ${filter}: FAILED - ${err.message}`);
    }
  }

  console.log("\n=== search");
  const results = await posts.getSearchPosts({
    searchQuery: "breaking bad",
    page: 1,
    providerValue: "redflix",
    signal,
    providerContext: makeContext(),
  });
  console.log(`  ${results.length} result(s)`);
  results.slice(0, 5).forEach((r) => console.log(`    ${r.title}`));

  console.log("\n=== movie");
  const movie = results.find((r) => JSON.parse(r.link).type === "movie");
  if (movie) {
    const info = await meta.getMeta({
      link: movie.link,
      providerContext: makeContext(),
    });
    console.log(`  ${info.title} [${info.type}] imdb=${info.imdbId}`);
    const direct = (info.linkList[0] || {}).directLinks || [];
    if (direct.length) await report(info.title, direct[0].link, "movie");
  }

  console.log("\n=== series (deep episode identity)");
  const series = results.find((r) => JSON.parse(r.link).type === "tv");
  if (series) {
    const info = await meta.getMeta({
      link: series.link,
      providerContext: makeContext(),
    });
    console.log(`  ${info.title}: ${info.linkList.length} season(s)`);

    const season3 = info.linkList.find((l) => /Season 3\b/.test(l.title));
    const target = season3 || info.linkList.find((l) => l.episodesLink);
    if (target) {
      const list = await episodes.getEpisodes({
        url: target.episodesLink,
        providerContext: makeContext(),
      });
      console.log(`  ${target.title}: ${list.length} episode(s)`);

      // Two different episodes must resolve to different files - that is the
      // check that catches a backend silently serving S1E1 for everything.
      const first = list[0];
      const deep = list.find((e) => /Episode 7/.test(e.title)) || list[list.length - 1];
      const a = first ? await report(`${info.title} - ${first.title}`, first.link, "series") : [];
      const b = deep ? await report(`${info.title} - ${deep.title}`, deep.link, "series") : [];

      if (a.length && b.length) {
        const identical = a[0] === b[0];
        console.log(
          identical
            ? "\n  !! WARNING: two different episodes resolved to the SAME file"
            : "\n  distinct episodes resolve to distinct files",
        );
      }
    }
  }

  console.log("\ndone");
})();
