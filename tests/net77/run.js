/**
 * Offline verification for the net77 (NetMirror) provider.
 *
 *   node tests/net77/run.js
 *
 * Runs the built dist/ modules against replayed live responses. The focus is
 * the streaming contract: every link handed to the player must be playable
 * (real asset, correct episode, and carrying the headers the CDN demands).
 */
const path = require("path");
const { createContext } = require("./mock-context");

const rootDir = path.join(__dirname, "..", "..");
const load = (mod) => require(path.join(rootDir, "dist", "net77", mod));

const posts = load("posts.js");
const meta = load("meta.js");
const episodes = load("episodes.js");
const stream = load("stream.js");
const settings = load("settings.js");
const catalog = load("catalog.js");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  \u2717 ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function section(title, fn) {
  console.log(`\n${title}`);
  try {
    await fn();
  } catch (err) {
    failed += 1;
    failures.push(`${title} (threw)`);
    console.log(`  \u2717 threw: ${err && err.message}`);
  }
}

const signal = new AbortController().signal;

(async () => {
  /* ---------------------------------------------------------------- */
  await section("catalog", async () => {
    check("exposes catalog rows", Array.isArray(catalog.catalog) && catalog.catalog.length > 0);
    check(
      "every filter is <ott>|<kind>",
      catalog.catalog.every((c) => /^(nf|pv)\|[a-z]+$/.test(c.filter)),
      JSON.stringify(catalog.catalog.map((c) => c.filter)),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("settings", async () => {
    const { context } = createContext();
    const schema = await settings.getSettingsSchema({ providerContext: context });
    const keys = schema.map((f) => f.key);
    check("exposes a mirror override", keys.includes("net77BaseUrl"));
    check("exposes the fallback toggle", keys.includes("net77UseFallback"));
    check(
      "every field has a label and type",
      schema.every((f) => f.key && f.label && f.type),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getPosts", async () => {
    const { context } = createContext();

    const nf = await posts.getPosts({
      filter: "nf|home",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("netflix home returns posts", nf.length > 0, `${nf.length}`);
    check(
      "posts carry title, link and image",
      nf.every((p) => typeof p.link === "string" && p.link && "title" in p && "image" in p),
    );
    check(
      "links are decodable tokens carrying the ott",
      nf.every((p) => JSON.parse(p.link).ott === "nf"),
    );
    check(
      "poster URLs are absolute",
      nf.every((p) => /^https:\/\//.test(p.image)),
    );

    const pv = await posts.getPosts({
      filter: "pv|home",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("prime home returns posts", pv.length > 0, `${pv.length}`);
    check("prime posts tagged pv", pv.every((p) => JSON.parse(p.link).ott === "pv"));

    // A page whose markup has no data-post attributes must still yield ids.
    const { context: noAttr } = createContext({ homeWithoutDataPost: true });
    const recovered = await posts.getPosts({
      filter: "pv|home",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: noAttr,
    });
    check(
      "recovers ids from poster URLs when data-post is absent",
      recovered.length > 0,
      `${recovered.length}`,
    );

    // Browse pages walk the alphabet.
    const browse = await posts.getPosts({
      filter: "pv|browse",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("browse page 1 returns posts", browse.length > 0);
    check(
      "browse marks series vs movie from the runtime field",
      browse.some((p) => JSON.parse(p.link).type === "series") &&
        browse.some((p) => JSON.parse(p.link).type === "movie"),
    );
    const beyondAlphabet = await posts.getPosts({
      filter: "pv|browse",
      page: 99,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("browse stops past the alphabet", beyondAlphabet.length === 0);

    const homePage2 = await posts.getPosts({
      filter: "nf|home",
      page: 2,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("home is not paginated", homePage2.length === 0);
  });

  /* ---------------------------------------------------------------- */
  await section("getSearchPosts", async () => {
    const { context } = createContext();

    const results = await posts.getSearchPosts({
      searchQuery: "reacher",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("finds titles across catalogues", results.length > 0, `${results.length}`);
    check(
      "search results carry real titles",
      results.some((p) => /reacher/i.test(p.title)),
    );
    check("no duplicate links", new Set(results.map((p) => p.link)).size === results.length);

    const empty = await posts.getSearchPosts({
      searchQuery: "   ",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("blank query returns nothing", empty.length === 0);

    const page2 = await posts.getSearchPosts({
      searchQuery: "reacher",
      page: 2,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("search is single page", page2.length === 0);
  });

  /* ---------------------------------------------------------------- */
  await section("guest session", async () => {
    const { context, calls, state } = createContext();
    await posts.getSearchPosts({
      searchQuery: "reacher",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("negotiates a guest session via verify.php", state.sessionIssued > 0);
    check(
      "sends t_hash_t + ott cookies on API calls",
      calls.some(
        (c) =>
          c.url.includes("search.php") &&
          /t_hash_t=/.test((c.config.headers || {}).Cookie || "") &&
          /ott=/.test((c.config.headers || {}).Cookie || ""),
      ),
    );

    // Session is cached, not renegotiated on every call.
    const before = state.sessionIssued;
    await posts.getSearchPosts({
      searchQuery: "stranger",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check("reuses the cached session", state.sessionIssued === before);

    // And it recovers when the backend rejects one.
    const { context: stale, state: staleState } = createContext({
      rejectFirstSession: true,
    });
    const info = await meta.getMeta({
      link: JSON.stringify({ ott: "pv", id: "0P52WN3GC5OHP25WVULFKF2OUD" }),
      providerContext: stale,
    });
    check("retries after an Invalid User rejection", Boolean(info.title));
    check("re-issued the session", staleState.sessionIssued >= 2);
  });

  /* ---------------------------------------------------------------- */
  await section("getMeta - movie", async () => {
    const { context } = createContext();
    const info = await meta.getMeta({
      link: JSON.stringify({
        ott: "pv",
        id: "0P52WN3GC5OHP25WVULFKF2OUD",
        title: "Jack Reacher",
      }),
      providerContext: context,
    });

    check("title", info.title === "Jack Reacher", info.title);
    check("typed as movie", info.type === "movie", info.type);
    check("has a synopsis", info.synopsis.length > 20);
    check("has cast", Array.isArray(info.cast) && info.cast.length > 0);
    check("year is tagged", (info.tags || []).includes("2012"));
    check("rating is numeric", info.rating === "7", info.rating);
    check("exactly one movie link", info.linkList.length === 1);
    const direct = info.linkList[0].directLinks || [];
    check("movie link is direct", direct.length === 1);
    check(
      "movie token is typed",
      JSON.parse(direct[0].link).type === "movie",
    );
    check("imdbId resolved for Cinemeta", info.imdbId === "tt0790724", info.imdbId);
    check("tmdbId resolved", info.tmdbId === "75780", info.tmdbId);
  });

  /* ---------------------------------------------------------------- */
  await section("getMeta - series", async () => {
    const { context } = createContext();
    const info = await meta.getMeta({
      link: JSON.stringify({ ott: "pv", id: "0RTZ57DQ6PBHH29UN5JS7U7CW4" }),
      providerContext: context,
    });

    check("typed as series", info.type === "series", info.type);
    check("one entry per season", info.linkList.length === 4, `${info.linkList.length}`);
    check(
      "seasons are labelled in order",
      info.linkList.map((l) => l.title).join(",") ===
        "Season 1,Season 2,Season 3,Season 4",
      info.linkList.map((l) => l.title).join(","),
    );
    check(
      "seasons defer to episodes.ts (no directLinks)",
      info.linkList.every((l) => l.episodesLink && !l.directLinks),
    );
    const token = JSON.parse(info.linkList[1].episodesLink);
    check("season token keeps the season id", token.id === "0KM1Z0B2EEM4SNVBEINBEI8BAT");
    check("season token keeps the parent series id", token.seriesId === "0RTZ57DQ6PBHH29UN5JS7U7CW4");
    check("season token carries the season number", token.season === 2);
    check("season token carries the show title", token.title === "REACHER");
    check("series imdbId resolved", info.imdbId === "tt9288030", info.imdbId);
  });

  /* ---------------------------------------------------------------- */
  await section("TMDB lookups are cached", async () => {
    const { context, calls } = createContext();
    const link = JSON.stringify({ ott: "pv", id: "0P52WN3GC5OHP25WVULFKF2OUD" });
    await meta.getMeta({ link, providerContext: context });
    const afterFirst = calls.filter((c) =>
      c.url.includes("api.themoviedb.org"),
    ).length;
    await meta.getMeta({ link, providerContext: context });
    const afterSecond = calls.filter((c) =>
      c.url.includes("api.themoviedb.org"),
    ).length;
    check("first lookup queries TMDB", afterFirst > 0, `${afterFirst}`);
    check(
      "second lookup is served from cache",
      afterSecond === afterFirst,
      `${afterFirst} -> ${afterSecond}`,
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getEpisodes", async () => {
    const { context } = createContext();
    const list = await episodes.getEpisodes({
      url: JSON.stringify({
        ott: "pv",
        id: "0KM1Z0B2EEM4SNVBEINBEI8BAT",
        seriesId: "0RTZ57DQ6PBHH29UN5JS7U7CW4",
        season: 2,
        title: "REACHER",
      }),
      providerContext: context,
    });

    check("returns the season's episodes", list.length === 3, `${list.length}`);
    check("episodes are numbered in order", list[0].title.startsWith("Episode 1"));
    check("episode names are included", /ATM/.test(list[0].title), list[0].title);
    check("episodes carry descriptions", Boolean(list[0].description));
    check("episodes carry thumbnails", /^https:\/\//.test(list[0].image || ""));
    const epToken = JSON.parse(list[1].link);
    check("episode token has season + episode", epToken.season === 2 && epToken.episode === 2);
    check("episode token points at the episode id", epToken.id === "0NHZAPQTEGFHGOM3HVAB7EXUL3");
    check("no duplicate episodes", new Set(list.map((e) => e.link)).size === list.length);
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - healthy native master", async () => {
    const { context, calls } = createContext({ master: "real" });
    const streams = await stream.getStream({
      link: JSON.stringify({
        ott: "pv",
        id: "0FIMMPWASW7MF5N1S3A92HS8HM",
        type: "series",
        title: "REACHER",
        season: 2,
        episode: 1,
      }),
      type: "series",
      signal,
      providerContext: context,
    });

    check("returns streams", streams.length > 0, `${streams.length}`);
    check("all links are absolute", streams.every((s) => /^https?:\/\//.test(s.link)));
    check("all links are HLS", streams.every((s) => s.type === "m3u8"));
    check(
      "every stream carries a Referer (CDN 404s without it)",
      streams.every((s) => s.headers && s.headers.Referer),
    );
    check(
      "no Origin header (CDN treats it as a CORS XHR)",
      streams.every((s) => !s.headers.Origin && !s.headers.origin),
    );
    check(
      "streams carry the hd cookie",
      streams.every((s) => /hd=on/.test(s.headers.Cookie || "")),
    );
    check("subtitles are attached", (streams[0].subtitles || []).length > 0);
    check(
      "subtitle URLs are absolute",
      (streams[0].subtitles || []).every((t) => /^https:\/\//.test(t.uri)),
    );
    check(
      "protocol-relative subtitle URLs were fixed up",
      (streams[0].subtitles || []).every((t) => !t.uri.startsWith("//")),
    );
    check(
      "quality labels are mapped",
      streams.some((s) => s.quality === "1080") && streams.some((s) => s.quality === "720"),
      streams.map((s) => s.quality).join(","),
    );
    check(
      "the master was verified before being returned",
      calls.some((c) => c.url.includes(".m3u8")),
    );
    check(
      "did not fall through to the MP4 fallback",
      !calls.some((c) => c.url.includes("/api/embed-tmdb/")),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - placeholder is rejected, fallback used", async () => {
    const { context, calls } = createContext({
      master: "placeholder",
      newTvDown: true,
    });
    const streams = await stream.getStream({
      link: JSON.stringify({
        ott: "pv",
        id: "0P52WN3GC5OHP25WVULFKF2OUD",
        type: "movie",
        title: "Jack Reacher",
        year: "2012",
      }),
      type: "movie",
      signal,
      providerContext: context,
    });

    check("still returns playable streams", streams.length > 0, `${streams.length}`);
    check(
      "never serves the 220884 guest placeholder",
      streams.every((s) => !s.link.includes("/files/220884/")),
      streams.map((s) => s.link).join(" "),
    );
    check("fell back to progressive MP4", streams.every((s) => s.type === "mp4"));
    check(
      "fallback links carry the anti-hotlink Referer",
      streams.every((s) => s.headers.Referer === "https://videodownloader.site/"),
    );
    check(
      "resolved the title through TMDB first",
      calls.some((c) => c.url.includes("api.themoviedb.org")),
    );
    check(
      "offers multiple resolutions",
      new Set(streams.map((s) => s.quality)).size > 1,
      streams.map((s) => s.quality).join(","),
    );
    check(
      "sorted best-quality first for playback",
      Number(streams[0].quality) >= Number(streams[streams.length - 1].quality),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - NewTV recovery when playlist.php is down", async () => {
    const { context } = createContext({ playlistDown: true, master: "real" });
    const streams = await stream.getStream({
      link: JSON.stringify({
        ott: "pv",
        id: "0FIMMPWASW7MF5N1S3A92HS8HM",
        type: "series",
        title: "REACHER",
        season: 2,
        episode: 1,
      }),
      type: "series",
      signal,
      providerContext: context,
    });
    check("recovers via the app's media API", streams.length > 0, `${streams.length}`);
    check("NewTV links are HLS", streams.every((s) => s.type === "m3u8"));
    check(
      "NewTV links carry a Referer",
      streams.every((s) => s.headers && s.headers.Referer),
    );
    check(
      "expanded the master into per-rendition variants",
      streams.length > 1,
      `${streams.length}`,
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - deep episode via the fallback", async () => {
    // The fallback must request the episode with the `se`/`ep` selectors so a
    // late-season episode resolves to its own file, not to S1E1.
    const { context, calls } = createContext({
      master: "placeholder",
      newTvDown: true,
    });
    const streams = await stream.getStream({
      link: JSON.stringify({
        ott: "pv",
        id: "0M7AJKR420MQS1WQ3NYN7IOSIS",
        type: "series",
        title: "REACHER",
        season: 2,
        episode: 7,
      }),
      type: "series",
      signal,
      providerContext: context,
    });

    check("resolves a mid-season episode", streams.length > 0, `${streams.length}`);
    const embed = calls.find((c) => c.url.includes("/api/embed-tmdb/"));
    check("used the se/ep selectors", /[?&]se=2(&|$)/.test(embed.url) && /[?&]ep=7(&|$)/.test(embed.url), embed && embed.url);
    check("asked for a tv title", /type=tv/.test(embed.url));
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - refuses a mismatched episode", async () => {
    // If the backend ignores the selectors and answers S1E1, serving that for
    // S2E7 would silently play the wrong thing.
    const { context } = createContext({
      master: "placeholder",
      newTvDown: true,
      legacyEpisodeParamsOnly: true,
    });
    let message = "";
    try {
      await stream.getStream({
        link: JSON.stringify({
          ott: "pv",
          id: "0M7AJKR420MQS1WQ3NYN7IOSIS",
          type: "series",
          title: "REACHER",
          season: 2,
          episode: 7,
        }),
        type: "series",
        signal,
        providerContext: context,
      });
    } catch (err) {
      message = err.message;
    }
    check("throws instead of serving episode 1", Boolean(message), "no error raised");
    check(
      "explains that the title is gated",
      /placeholder|no playable source/i.test(message),
      message,
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - accepts the fallback for S1E1", async () => {
    const { context } = createContext({
      master: "placeholder",
      newTvDown: true,
    });
    const streams = await stream.getStream({
      link: JSON.stringify({
        ott: "pv",
        id: "0FIMMPWASW7MF5N1S3A92HS8HM",
        type: "series",
        title: "REACHER",
        season: 1,
        episode: 1,
      }),
      type: "series",
      signal,
      providerContext: context,
    });
    check("serves the episode when it matches", streams.length > 0, `${streams.length}`);
    check("as MP4", streams.every((s) => s.type === "mp4"));
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - download ordering", async () => {
    const { context } = createContext({ master: "placeholder", newTvDown: true });
    const streams = await stream.getStream({
      link: JSON.stringify({
        ott: "pv",
        id: "0P52WN3GC5OHP25WVULFKF2OUD",
        type: "movie",
        title: "Jack Reacher",
        year: "2012",
      }),
      type: "movie",
      signal,
      providerContext: context,
      isDownload: true,
    });
    check("returns download candidates", streams.length > 0);
    check("progressive MP4 first", streams[0].type === "mp4");
    check(
      "highest quality first",
      Number(streams[0].quality) === 1080,
      streams.map((s) => s.quality).join(","),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - honest failure", async () => {
    const { context } = createContext({
      master: "placeholder",
      newTvDown: true,
      net27: require("./fixtures").NET27_NO_SOURCE,
    });
    let message = "";
    try {
      await stream.getStream({
        link: JSON.stringify({
          ott: "nf",
          id: "70131314",
          type: "movie",
          title: "Inception",
          year: "2010",
        }),
        type: "movie",
        signal,
        providerContext: context,
      });
    } catch (err) {
      message = err.message;
    }
    check("throws rather than returning junk", Boolean(message));
    check("error names the provider", /net77/.test(message), message);
    check(
      "error explains the gating",
      /placeholder|signed-in|no playable source/i.test(message),
      message,
    );
  });

  /* ---------------------------------------------------------------- */
  await section("settings are honoured", async () => {
    const { context, calls } = createContext({
      settings: { net77BaseUrl: "https://net27.cc" },
    });
    await posts.getSearchPosts({
      searchQuery: "stranger",
      page: 1,
      providerValue: "net77",
      signal,
      providerContext: context,
    });
    check(
      "custom mirror is used",
      calls.some((c) => c.url.startsWith("https://net27.cc")),
    );

    const { context: noFallback, calls: nfCalls } = createContext({
      master: "placeholder",
      newTvDown: true,
      settings: { net77UseFallback: false },
    });
    let threw = false;
    try {
      await stream.getStream({
        link: JSON.stringify({
          ott: "pv",
          id: "0P52WN3GC5OHP25WVULFKF2OUD",
          type: "movie",
          title: "Jack Reacher",
          year: "2012",
        }),
        type: "movie",
        signal,
        providerContext: noFallback,
      });
    } catch {
      threw = true;
    }
    check("fallback toggle is respected", threw);
    check(
      "no net27 request when disabled",
      !nfCalls.some((c) => c.url.includes("/api/embed-tmdb/")),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("link token compatibility", async () => {
    const { context } = createContext({ master: "real" });
    // Hand-written / legacy shapes must still resolve.
    const streams = await stream.getStream({
      link: "pv:0FIMMPWASW7MF5N1S3A92HS8HM",
      type: "movie",
      signal,
      providerContext: context,
    });
    check("accepts a bare ott:id link", streams.length > 0, `${streams.length}`);
  });

  /* ---------------------------------------------------------------- */
  console.log(
    `\n${passed} passed, ${failed} failed` +
      (failures.length ? `\nfailing: ${failures.join(", ")}` : ""),
  );
  process.exit(failed ? 1 : 0);
})();
