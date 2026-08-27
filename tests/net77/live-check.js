/**
 * Live smoke test for the net77 provider.
 *
 *   node tests/net77/live-check.js
 *
 * Unlike run.js (which replays captured fixtures) this hits net77.cc for real.
 * It needs outbound access to net77.cc / net27.cc / tv.imgcdn.kim, so it is a
 * manual tool rather than part of the default suite.
 *
 * It reports, per title: whether the native playlist is real or the guest
 * placeholder, whether the fallback produced anything, and whether the first
 * returned link actually responds with playable content.
 */
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const rootDir = path.join(__dirname, "..", "..");
const load = (mod) => require(path.join(rootDir, "dist", "net77", mod));

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

/** Confirms a link really serves media (manifest body or a 2xx/206 for mp4). */
async function probe(stream_) {
  try {
    if (stream_.type === "m3u8") {
      const res = await axios.get(stream_.link, {
        headers: stream_.headers,
        timeout: 20000,
        validateStatus: () => true,
      });
      const body = typeof res.data === "string" ? res.data : "";
      if (res.status >= 400) return `HTTP ${res.status}`;
      if (!body.includes("#EXTM3U")) return "not a manifest";
      const variants = body
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      if (variants.every((v) => v.includes("/files/220884/")))
        return "PLACEHOLDER";
      return `ok (${variants.length} variants)`;
    }
    const res = await axios.get(stream_.link, {
      headers: Object.assign({ Range: "bytes=0-1023" }, stream_.headers),
      timeout: 20000,
      responseType: "arraybuffer",
      validateStatus: () => true,
    });
    if (res.status >= 400) return `HTTP ${res.status}`;
    return `ok (${res.status}, ${res.headers["content-type"] || "?"})`;
  } catch (err) {
    return `error: ${err.message}`;
  }
}

async function checkTitle(label, link, type) {
  console.log(`\n--- ${label}`);
  try {
    const streams = await stream.getStream({
      link,
      type,
      signal,
      providerContext: makeContext(),
    });
    console.log(`    ${streams.length} stream(s)`);
    for (const s of streams.slice(0, 3)) {
      console.log(`      [${s.type} ${s.quality || "?"}] ${s.server}`);
      console.log(`        ${s.link.slice(0, 110)}`);
      console.log(`        probe: ${await probe(s)}`);
    }
    const placeholders = streams.filter((s) =>
      s.link.includes("/files/220884/"),
    );
    console.log(
      placeholders.length
        ? `    !! ${placeholders.length} placeholder link(s) leaked`
        : "    no placeholder links leaked",
    );
  } catch (err) {
    console.log(`    no stream: ${err.message}`);
  }
}

(async () => {
  console.log("=== search");
  const results = await posts.getSearchPosts({
    searchQuery: "reacher",
    page: 1,
    providerValue: "net77",
    signal,
    providerContext: makeContext(),
  });
  console.log(`  ${results.length} result(s)`);
  results.slice(0, 5).forEach((r) => console.log(`    ${r.title}`));
  if (!results.length) {
    console.log("  search returned nothing - aborting");
    process.exit(1);
  }

  console.log("\n=== catalogue");
  for (const filter of ["nf|home", "pv|home", "pv|browse"]) {
    try {
      const list = await posts.getPosts({
        filter,
        page: 1,
        providerValue: "net77",
        signal,
        providerContext: makeContext(),
      });
      console.log(`  ${filter}: ${list.length} post(s)`);
    } catch (err) {
      console.log(`  ${filter}: FAILED - ${err.message}`);
    }
  }

  console.log("\n=== meta + episodes");
  const series = results.find((r) => JSON.parse(r.link).type === "series");
  const movie = results.find((r) => JSON.parse(r.link).type === "movie");

  if (series) {
    const info = await meta.getMeta({
      link: series.link,
      providerContext: makeContext(),
    });
    console.log(`  ${info.title} [${info.type}] ${info.linkList.length} season(s)`);
    const season = info.linkList.find((l) => l.episodesLink);
    if (season) {
      const list = await episodes.getEpisodes({
        url: season.episodesLink,
        providerContext: makeContext(),
      });
      console.log(`  ${season.title}: ${list.length} episode(s)`);
      if (list.length) {
        await checkTitle(`${info.title} - ${list[0].title}`, list[0].link, "series");
      }
    }
  }

  if (movie) {
    const info = await meta.getMeta({
      link: movie.link,
      providerContext: makeContext(),
    });
    console.log(`\n  ${info.title} [${info.type}]`);
    const direct = (info.linkList[0] || {}).directLinks || [];
    if (direct.length) await checkTitle(info.title, direct[0].link, "movie");
  }

  console.log("\ndone");
})();
