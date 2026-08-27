/**
 * Offline verification for the redflix provider.
 *
 *   npm run test:redflix
 *
 * Runs the built dist/ modules against replayed live responses. The focus is
 * the streaming contract: every link handed to the player must be verified
 * playable, correctly identified, and carry the headers the CDN requires.
 */
const path = require("path");
const { createContext } = require("./mock-context");

const rootDir = path.join(__dirname, "..", "..");
const load = (mod) => require(path.join(rootDir, "dist", "redflix", mod));

const catalog = load("catalog.js");
const posts = load("posts.js");
const meta = load("meta.js");
const episodes = load("episodes.js");
const stream = load("stream.js");
const settings = load("settings.js");

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
const tok = (o) => JSON.stringify(o);

(async () => {
  /* ---------------------------------------------------------------- */
  await section("catalog", async () => {
    check("exposes catalog rows", Array.isArray(catalog.catalog) && catalog.catalog.length > 0);
    check("exposes genres", Array.isArray(catalog.genres) && catalog.genres.length > 0);
    check(
      "every filter is <media>|<kind>[|arg]",
      catalog.catalog
        .concat(catalog.genres)
        .every((c) => /^(all|movie|tv)\|[a-z_]+(\|\d+)?$/.test(c.filter)),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("settings", async () => {
    const { context } = createContext();
    const schema = await settings.getSettingsSchema({ providerContext: context });
    const keys = schema.map((f) => f.key);
    check("exposes a mirror override", keys.includes("redflixBaseUrl"));
    check("exposes per-source toggles", keys.includes("redflixUseVideasy") && keys.includes("redflixUseVidfast"));
    check("exposes the verification toggle", keys.includes("redflixVerifyStreams"));
    check("every field has key/label/type", schema.every((f) => f.key && f.label && f.type));
  });

  /* ---------------------------------------------------------------- */
  await section("getPosts", async () => {
    const { context, calls } = createContext();

    const trending = await posts.getPosts({
      filter: "all|trending",
      page: 1,
      providerValue: "redflix",
      signal,
      providerContext: context,
    });
    check("trending returns posts", trending.length > 0, `${trending.length}`);
    check("posts carry title/link/image", trending.every((p) => p.title && p.link && "image" in p));
    check(
      "drops non-media results (people)",
      !trending.some((p) => /Some Person/.test(p.title)),
    );
    check(
      "media type is carried through from TMDB",
      trending.some((p) => JSON.parse(p.link).type === "tv") &&
        trending.some((p) => JSON.parse(p.link).type === "movie"),
    );
    check(
      "posters are absolute TMDB URLs",
      trending.every((p) => /^https:\/\/image\.tmdb\.org\//.test(p.image)),
    );
    check(
      "tokens carry title and year for the source lookup",
      trending.every((p) => {
        const t = JSON.parse(p.link);
        return t.tmdbId && t.title;
      }),
    );

    // Pagination must reach the mirror, since the site itself is infinite-scroll.
    const page2 = await posts.getPosts({
      filter: "movie|popular",
      page: 2,
      providerValue: "redflix",
      signal,
      providerContext: context,
    });
    check("paged request returns posts", page2.length > 0);
    check(
      "page number is forwarded upstream",
      calls.some((c) => c.url.includes("page=2")),
    );

    const tvRow = await posts.getPosts({
      filter: "tv|popular",
      page: 1,
      providerValue: "redflix",
      signal,
      providerContext: context,
    });
    check("tv row is typed as tv", tvRow.every((p) => JSON.parse(p.link).type === "tv"));

    const genreRow = await posts.getPosts({
      filter: "movie|genre|28",
      page: 1,
      providerValue: "redflix",
      signal,
      providerContext: context,
    });
    check("genre row returns posts", genreRow.length > 0);
    check(
      "genre id is forwarded to /discover",
      calls.some((c) => c.url.includes("/discover/movie") && c.url.includes("with_genres=28")),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getSearchPosts", async () => {
    const { context, calls } = createContext();
    const results = await posts.getSearchPosts({
      searchQuery: "breaking bad",
      page: 1,
      providerValue: "redflix",
      signal,
      providerContext: context,
    });
    check("finds titles", results.length > 0, `${results.length}`);
    check("prefers the site's own search", calls.some((c) => c.url.includes("/browse?q=")));
    check("titles are cleaned of 'Poster for' prefixes", results.every((p) => !/^Poster for/i.test(p.title)));
    check("no duplicates despite repeated links", new Set(results.map((p) => p.link)).size === results.length);
    check("series typed correctly from the href", JSON.parse(results[0].link).type === "tv");

    const blank = await posts.getSearchPosts({
      searchQuery: "   ",
      page: 1,
      providerValue: "redflix",
      signal,
      providerContext: context,
    });
    check("blank query returns nothing", blank.length === 0);

    // When the site is unreachable the TMDB mirror must cover for it.
    const { context: down, calls: downCalls } = createContext({ siteDown: true });
    const fallback = await posts.getSearchPosts({
      searchQuery: "breaking bad",
      page: 1,
      providerValue: "redflix",
      signal,
      providerContext: down,
    });
    check("falls back to TMDB search when the site is down", fallback.length > 0);
    check("fallback filters out people", !fallback.some((p) => /Vince Gilligan/.test(p.title)));
    check("fallback queried the mirror", downCalls.some((c) => c.url.includes("/search/multi")));
  });

  /* ---------------------------------------------------------------- */
  await section("getMeta - movie", async () => {
    const { context } = createContext();
    const info = await meta.getMeta({
      link: tok({ tmdbId: "1516698", type: "movie" }),
      providerContext: context,
    });
    check("title", info.title === "The Last Sunrise", info.title);
    check("typed as movie", info.type === "movie");
    check("synopsis present", info.synopsis.length > 20);
    check("imdbId resolved for Cinemeta", info.imdbId === "tt37654096", info.imdbId);
    check("tmdbId carried", info.tmdbId === "1516698");
    check("year tagged", (info.tags || []).includes("2026"));
    check("genres tagged", (info.tags || []).includes("Romance"));
    check("cast present", (info.cast || []).length > 0);
    check("rating formatted", info.rating === "7.9", info.rating);
    check("single movie link", info.linkList.length === 1);
    const direct = info.linkList[0].directLinks || [];
    check("movie link is direct", direct.length === 1);
    check("movie token typed", JSON.parse(direct[0].link).type === "movie");
    check("webUrl points at the site", /redflix\.club\/play\?id=1516698/.test(info.webUrl || ""));
  });

  /* ---------------------------------------------------------------- */
  await section("getMeta - series", async () => {
    const { context } = createContext();
    const info = await meta.getMeta({
      link: tok({ tmdbId: "1396", type: "tv" }),
      providerContext: context,
    });
    check("typed as series", info.type === "series");
    check("imdbId resolved", info.imdbId === "tt0903747", info.imdbId);
    check(
      "empty future seasons are dropped",
      !info.linkList.some((l) => /Season 6/.test(l.title)),
      info.linkList.map((l) => l.title).join(","),
    );
    check("specials kept when they have episodes", info.linkList.some((l) => /Specials/.test(l.title)));
    check(
      "seasons defer to episodes.ts",
      info.linkList.every((l) => l.episodesLink && !l.directLinks),
    );
    const season3 = info.linkList.find((l) => /Season 3/.test(l.title));
    const t = JSON.parse(season3.episodesLink);
    check("season token carries the season number", t.season === 3);
    check("season token carries title/year for source matching", Boolean(t.title && t.year));
    check("season token carries imdbId", t.imdbId === "tt0903747");
  });

  /* ---------------------------------------------------------------- */
  await section("getEpisodes", async () => {
    const { context } = createContext();
    const list = await episodes.getEpisodes({
      url: tok({ tmdbId: "1396", type: "tv", season: 3, title: "Breaking Bad", year: "2008" }),
      providerContext: context,
    });
    check("returns the season's episodes", list.length === 3, `${list.length}`);
    check("unaired episodes are excluded", !list.some((e) => /Future Episode/.test(e.title)));
    check("episode names included", /No Más/.test(list[0].title), list[0].title);
    check("descriptions present", Boolean(list[0].description));
    check("stills present", /^https:\/\/image\.tmdb\.org\//.test(list[0].image || ""));
    check("sorted by episode number", list.map((e) => parseInt(/Episode (\d+)/.exec(e.title)[1], 10)).join(",") === "1,2,7");
    const deep = JSON.parse(list[2].link);
    check("deep episode token is exact", deep.season === 3 && deep.episode === 7);
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - movie", async () => {
    const { context, calls } = createContext();
    const streams = await stream.getStream({
      link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
      type: "movie",
      signal,
      providerContext: context,
    });

    check("returns streams", streams.length > 0, `${streams.length}`);
    check("all links absolute", streams.every((s) => /^https?:\/\//.test(s.link)));
    check(
      "every stream carries a Referer (CDN 403s without it)",
      streams.every((s) => s.headers && s.headers.Referer),
    );
    check(
      "no Origin header (CDNs treat it as a CORS XHR)",
      streams.every((s) => !s.headers.Origin && !s.headers.origin),
    );
    check("subtitles attached", streams.some((s) => (s.subtitles || []).length > 0));
    check(
      "subtitle URIs absolute",
      streams.every((s) => (s.subtitles || []).every((t) => /^https?:\/\//.test(t.uri))),
    );
    check(
      "srt vs vtt typed correctly",
      streams.some((s) =>
        (s.subtitles || []).some((t) => t.type === "application/x-subrip"),
      ),
    );
    check("qualities mapped", streams.some((s) => s.quality === "1080"));
    check(
      "both source families contributed",
      streams.some((s) => /VidFast/.test(s.server)) &&
        streams.some((s) => /Yoru|Breach|Neon/.test(s.server)),
      streams.map((s) => s.server).join(", "),
    );
    check("adaptive HLS ranked first for playback", streams[0].type === "m3u8");
    check(
      "every returned link was verified",
      calls.filter((c) => c.method === "GET" && /\.m3u8|\.mp4/.test(c.url)).length >= streams.length,
    );
    check("seed fetched before sources", calls.some((c) => c.url.includes("/seed?mediaId=1516698")));
    check(
      "title double-encoded for the backend",
      calls.some((c) => c.url.includes("title=The%2520Last%2520Sunrise")),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - deep episode identity", async () => {
    const { context, calls } = createContext();
    const streams = await stream.getStream({
      link: tok({
        tmdbId: "1396",
        type: "tv",
        title: "Breaking Bad",
        year: "2008",
        season: 3,
        episode: 7,
      }),
      type: "series",
      signal,
      providerContext: context,
    });
    check("resolves a mid-season episode", streams.length > 0, `${streams.length}`);
    check(
      "episode verified against TMDB first",
      calls.some((c) => /\/tv\/1396\/season\/3\/episode\/7/.test(c.url)),
    );
    check(
      "season/episode forwarded to Videasy",
      calls.some((c) => c.url.includes("seasonId=3") && c.url.includes("episodeId=7")),
    );
    check(
      "season/episode forwarded to VidFast path",
      calls.some((c) => /vidfast\.vc\/tv\/1396\/3\/7/.test(c.url)),
    );
    check("mediaType=tv sent", calls.some((c) => c.url.includes("mediaType=tv")));
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - refuses a non-existent episode", async () => {
    // Aggregators often fall back to S1E1 for an unknown episode, which would
    // silently play the wrong thing.
    const { context, calls } = createContext();
    let message = "";
    try {
      await stream.getStream({
        link: tok({ tmdbId: "1396", type: "tv", title: "Breaking Bad", season: 3, episode: 42 }),
        type: "series",
        signal,
        providerContext: context,
      });
    } catch (err) {
      message = err.message;
    }
    check("throws instead of serving a substitute", Boolean(message), "no error raised");
    check("error explains the episode is unknown", /does not exist/i.test(message), message);
    check(
      "never asked an embed provider for it",
      !calls.some((c) => c.url.includes("sources-with-title")),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - dead links are rejected", async () => {
    const { context } = createContext({ deadStreams: true });
    let message = "";
    try {
      await stream.getStream({
        link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
        type: "movie",
        signal,
        providerContext: context,
      });
    } catch (err) {
      message = err.message;
    }
    check("throws rather than returning dead links", Boolean(message));
    check("error mentions verification", /verification|dead|expired/i.test(message), message);
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - empty manifests are rejected", async () => {
    // A body can start with #EXTM3U and still contain no media at all.
    const { context } = createContext({ emptyManifest: true });
    let message = "";
    try {
      await stream.getStream({
        link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
        type: "movie",
        signal,
        providerContext: context,
      });
    } catch (err) {
      message = err.message;
    }
    check("throws on manifests with no variants or segments", Boolean(message), "accepted an empty manifest");
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - source resilience", async () => {
    // Videasy down -> VidFast still delivers.
    const { context: noVideasy } = createContext({ videasyDown: true });
    const a = await stream.getStream({
      link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
      type: "movie",
      signal,
      providerContext: noVideasy,
    });
    check("survives Videasy being down", a.length > 0, `${a.length}`);
    check("remaining streams are VidFast", a.every((s) => /VidFast/.test(s.server)));

    // VidFast down -> Videasy still delivers.
    const { context: noVidfast } = createContext({ vidfastDown: true });
    const b = await stream.getStream({
      link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
      type: "movie",
      signal,
      providerContext: noVidfast,
    });
    check("survives VidFast being down", b.length > 0, `${b.length}`);

    // An expired seed must not surface as a bogus stream.
    const { context: staleSeed } = createContext({ seedInvalid: true, vidfastDown: true });
    let message = "";
    try {
      await stream.getStream({
        link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
        type: "movie",
        signal,
        providerContext: staleSeed,
      });
    } catch (err) {
      message = err.message;
    }
    check("an invalid seed yields an error, not junk", Boolean(message), message);
  });

  /* ---------------------------------------------------------------- */
  await section("getStream - download ordering", async () => {
    const { context } = createContext();
    const streams = await stream.getStream({
      link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
      type: "movie",
      signal,
      providerContext: context,
      isDownload: true,
    });
    check("returns download candidates", streams.length > 0);
    check(
      "highest quality first",
      Number(streams[0].quality || 0) >= Number(streams[streams.length - 1].quality || 0),
      streams.map((s) => s.quality).join(","),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("settings are honoured", async () => {
    const { context, calls } = createContext({
      settings: { redflixUseVidfast: false },
    });
    const streams = await stream.getStream({
      link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
      type: "movie",
      signal,
      providerContext: context,
    });
    check("disabled source is skipped", !streams.some((s) => /VidFast/.test(s.server)));
    check("no VidFast requests made", !calls.some((c) => c.url.includes("vidfast.vc")));

    const { context: noVerify, calls: nvCalls } = createContext({
      deadStreams: true,
      settings: { redflixVerifyStreams: false },
    });
    const unverified = await stream.getStream({
      link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
      type: "movie",
      signal,
      providerContext: noVerify,
    });
    check("verification can be turned off", unverified.length > 0);
    check(
      "no probe requests when verification is off",
      !nvCalls.some((c) => c.method === "GET" && /master\.m3u8/.test(c.url)),
    );

    const { context: custom, calls: cCalls } = createContext({
      settings: { redflixEncDecApi: "https://my-enc-dec.example.com/api" },
    });
    await stream
      .getStream({
        link: tok({ tmdbId: "1516698", type: "movie", title: "The Last Sunrise", year: "2026" }),
        type: "movie",
        signal,
        providerContext: custom,
      })
      .catch(() => undefined);
    check(
      "custom decryption helper is used",
      cCalls.some((c) => c.url.startsWith("https://my-enc-dec.example.com/api")),
    );

    const { context: mirror, calls: mCalls } = createContext({
      settings: { redflixBaseUrl: "redflix.co" },
    });
    await posts.getSearchPosts({
      searchQuery: "breaking bad",
      page: 1,
      providerValue: "redflix",
      signal,
      providerContext: mirror,
    });
    check(
      "custom mirror is normalised and used",
      mCalls.some((c) => c.url.startsWith("https://redflix.co/browse")),
    );
  });

  /* ---------------------------------------------------------------- */
  await section("link token compatibility", async () => {
    const { context } = createContext();
    // A raw site URL must still resolve.
    const fromUrl = await stream.getStream({
      link: "https://redflix.club/play?id=1516698&type=movie",
      type: "movie",
      signal,
      providerContext: context,
    });
    check("accepts a site /play URL", fromUrl.length > 0, `${fromUrl.length}`);

    const fromShort = await stream.getStream({
      link: "tv:1396:3:7",
      type: "series",
      signal,
      providerContext: context,
    });
    check("accepts a bare tv:id:s:e link", fromShort.length > 0, `${fromShort.length}`);
  });

  /* ---------------------------------------------------------------- */
  console.log(
    `\n${passed} passed, ${failed} failed` +
      (failures.length ? `\nfailing: ${failures.join(", ")}` : ""),
  );
  process.exit(failed ? 1 : 0);
})();
