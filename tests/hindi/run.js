/**
 * Offline verification for the Hindi providers (moviesDrive, hdhub4u).
 *
 *   npm run test:hindi
 *
 * Runs the built dist/ modules against replayed live responses, across several
 * different titles - a dual-audio movie, a Hindi-only movie, a multi-season
 * dual-audio series and a Hindi web series - because these sites lay out
 * movies and series very differently.
 */
const path = require("path");
const { createContext, installFetchStub } = require("./mock-context");

const rootDir = path.join(__dirname, "..", "..");
const load = (provider, mod) =>
  require(path.join(rootDir, "dist", provider, mod));

const md = {
  catalog: load("moviesDrive", "catalog.js"),
  posts: load("moviesDrive", "posts.js"),
  meta: load("moviesDrive", "meta.js"),
  episodes: load("moviesDrive", "episodes.js"),
  stream: load("moviesDrive", "stream.js"),
  settings: load("moviesDrive", "settings.js"),
};

const hh = {
  catalog: load("hdhub4u", "catalog.js"),
  posts: load("hdhub4u", "posts.js"),
  meta: load("hdhub4u", "meta.js"),
  stream: load("hdhub4u", "stream.js"),
  settings: load("hdhub4u", "settings.js"),
};

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
const restoreFetch = installFetchStub();

(async () => {
  /* ================================================================ *
   * shared contract                                                   *
   * ================================================================ */
  await section("provider contract", async () => {
    for (const [name, p] of [
      ["moviesDrive", md],
      ["hdhub4u", hh],
    ]) {
      check(
        `${name}: catalog + genres exported`,
        Array.isArray(p.catalog.catalog) &&
          p.catalog.catalog.length > 0 &&
          Array.isArray(p.catalog.genres),
      );
      check(
        `${name}: getPosts/getSearchPosts exported`,
        typeof p.posts.getPosts === "function" &&
          typeof p.posts.getSearchPosts === "function",
      );
      check(`${name}: getMeta exported`, typeof p.meta.getMeta === "function");
      check(
        `${name}: getStream exported`,
        typeof p.stream.getStream === "function",
      );

      const { context } = createContext();
      const schema = await p.settings.getSettingsSchema({
        providerContext: context,
      });
      check(
        `${name}: settings expose a mirror override`,
        schema.some((f) => /BaseUrl$/.test(f.key)),
      );
    }
  });

  /* ================================================================ *
   * MoviesDrive                                                       *
   * ================================================================ */
  await section("moviesDrive: getPosts", async () => {
    const { context } = createContext();
    const posts = await md.posts.getPosts({
      filter: "",
      page: 1,
      providerValue: "moviesDrive",
      signal,
      providerContext: context,
    });

    check("returns posts", posts.length > 0, `${posts.length}`);
    check("titles are cleaned of 'Download' prefix", posts.every((p) => !/^Download /i.test(p.title)));
    check(
      "picks up the dual-audio movie",
      posts.some((p) => /Whisper Man/i.test(p.title)),
    );
    check(
      "picks up the Hindi movie",
      posts.some((p) => /Awarapan 2/i.test(p.title)),
    );
    check(
      "picks up the series",
      posts.some((p) => /Reacher/i.test(p.title)),
    );
    check(
      "category links are not treated as posts",
      !posts.some((p) => /^Bollywood$/i.test(p.title)),
    );
    check(
      "telegram banner is not treated as a post",
      !posts.some((p) => /telegram/i.test(p.title)),
    );
    check(
      "links stored relative so they survive a domain change",
      posts.every((p) => p.link.startsWith("/")),
      posts.map((p) => p.link).join(" "),
    );
    check("posters are absolute", posts.every((p) => /^https?:\/\//.test(p.image)));

    const paged = await md.posts.getPosts({
      filter: "category/bollywood/",
      page: 2,
      providerValue: "moviesDrive",
      signal,
      providerContext: context,
    });
    check("category paging works", paged.length > 0);
  });

  await section("moviesDrive: search (Jawan)", async () => {
    const { context, calls } = createContext();
    const results = await md.posts.getSearchPosts({
      searchQuery: "jawan",
      page: 1,
      providerValue: "moviesDrive",
      signal,
      providerContext: context,
    });
    check("finds titles", results.length > 0, `${results.length}`);
    check("uses the JSON search endpoint", calls.some((c) => c.url.includes("/search.php?q=jawan")));
    check("Jawan (2023) is present", results.some((p) => /^Jawan/i.test(p.title)));
    check("titles cleaned", results.every((p) => !/^Download /i.test(p.title)));
    check("no duplicates", new Set(results.map((p) => p.link)).size === results.length);

    const blank = await md.posts.getSearchPosts({
      searchQuery: "  ",
      page: 1,
      providerValue: "moviesDrive",
      signal,
      providerContext: context,
    });
    check("blank query returns nothing", blank.length === 0);
  });

  await section("moviesDrive: getMeta - movie (The Whisper Man)", async () => {
    const { context } = createContext();
    const info = await md.meta.getMeta({
      link: "/the-whisper-man-2026-web-dl-hindi-dd5-1-english-480p-720p-1080p-2160p-4k-sdr-x264-esubs-full-movie/",
      providerContext: context,
    });
    check("title parsed", /Whisper Man/i.test(info.title), info.title);
    check("typed as movie", info.type === "movie", info.type);
    check("imdbId extracted", info.imdbId === "tt11561116", info.imdbId);
    check("synopsis present", info.synopsis.length > 30);
    check("poster is the TMDB image, not a screenshot", /image\.tmdb\.org/.test(info.image), info.image);
    check("year tagged", (info.tags || []).includes("2026"));
    check("one entry per quality", info.linkList.length === 4, `${info.linkList.length}`);
    check(
      "every quality is a direct movie link",
      info.linkList.every((l) => (l.directLinks || []).length === 1),
    );
    check(
      "links point at mdrive archive pages",
      info.linkList.every((l) => /mdrive\.lol\/archive/.test(l.directLinks[0].link)),
    );
    check(
      "4K option retained",
      info.linkList.some((l) => /2160|4k/i.test(l.title)),
    );
  });

  await section("moviesDrive: getMeta - series (Reacher S1-S4)", async () => {
    const { context } = createContext();
    const info = await md.meta.getMeta({
      link: "/reacher-season-1-4/",
      providerContext: context,
    });
    check("typed as series", info.type === "series", info.type);
    check("imdbId extracted", info.imdbId === "tt9288030", info.imdbId);
    check("has season rows", info.linkList.length > 0, `${info.linkList.length}`);
    check(
      "seasons are labelled",
      info.linkList.every((l) => /^Season \d+/.test(l.title)),
      info.linkList.map((l) => l.title).join(" | "),
    );
    check(
      "covers seasons 1, 3 and 4",
      ["Season 1", "Season 3", "Season 4"].every((s) =>
        info.linkList.some((l) => l.title.startsWith(s)),
      ),
      info.linkList.map((l) => l.title).join(" | "),
    );
    check(
      "seasons defer to episodes.ts",
      info.linkList.every((l) => l.episodesLink && !l.directLinks),
    );
    check(
      "season Zip archives are excluded",
      !info.linkList.some((l) => /zip/i.test(l.title)),
      info.linkList.map((l) => l.title).join(" | "),
    );
    check(
      "seasons are ordered ascending",
      (() => {
        const nums = info.linkList.map((l) =>
          parseInt(/Season (\d+)/.exec(l.title)[1], 10),
        );
        return nums.every((n, i) => i === 0 || nums[i - 1] <= n);
      })(),
    );
  });

  await section("moviesDrive: getEpisodes", async () => {
    const { context } = createContext();
    const list = await md.episodes.getEpisodes({
      url: "https://mdrive.lol/archive/15688/",
      providerContext: context,
    });
    check("returns episodes", list.length === 3, `${list.length}`);
    check(
      "numbered in order",
      list.map((e) => e.title).join(",") === "Episode 1,Episode 2,Episode 3",
      list.map((e) => e.title).join(","),
    );
    check(
      "prefers HubCloud over GDFlix",
      list.every((e) => /hubcloud/i.test(e.link)),
      list.map((e) => e.link).join(" "),
    );
    check("no duplicate links", new Set(list.map((e) => e.link)).size === list.length);
    check(
      "each episode maps to its own distinct file",
      new Set(list.map((e) => e.link)).size === 3,
    );
  });

  await section("moviesDrive: getStream - movie", async () => {
    const { context } = createContext();
    const streams = await md.stream.getStream({
      link: "https://mdrive.lol/archive/17541/",
      type: "movie",
      signal,
      providerContext: context,
    });
    check("returns streams", streams.length > 0, `${streams.length}`);
    check("all links absolute", streams.every((s) => /^https?:\/\//.test(s.link)));
    check(
      "resolved through the real extractor to a CDN file",
      streams.some((s) => /cloudflarestorage|pixeldrain|workers-cf/i.test(s.link)),
      streams.map((s) => s.link.slice(0, 60)).join(" | "),
    );
    check("no mdrive archive pages leaked as streams", !streams.some((s) => /mdrive\.lol/.test(s.link)));
    check("every stream names its server", streams.every((s) => Boolean(s.server)));
  });

  await section("moviesDrive: getStream - episode", async () => {
    const { context } = createContext();
    const streams = await md.stream.getStream({
      link: "https://hubcloud.cx/drive/94ruuky3j1rjmym",
      type: "series",
      signal,
      providerContext: context,
    });
    check("episode resolves", streams.length > 0, `${streams.length}`);
    check(
      "resolves to a real file host",
      streams.some((s) => /cloudflarestorage|pixeldrain|workers-cf/i.test(s.link)),
    );
  });

  await section("moviesDrive: resilience", async () => {
    // Primary domain DNS-blocked -> must fail over to a sibling mirror.
    const { context, calls } = createContext({ mirrorDown: true });
    const posts = await md.posts.getPosts({
      filter: "",
      page: 1,
      providerValue: "moviesDrive",
      signal,
      providerContext: context,
    });
    check("survives a blocked primary domain", posts.length > 0, `${posts.length}`);
    check(
      "actually tried a different mirror",
      calls.some((c) => !c.url.startsWith("https://new3.moviesdrive.christmas")),
    );

    // Every file host dead -> honest error, never an empty success.
    const { context: dead } = createContext({ allHostsDead: true });
    let message = "";
    try {
      await md.stream.getStream({
        link: "https://mdrive.lol/archive/17541/",
        type: "movie",
        signal,
        providerContext: dead,
      });
    } catch (err) {
      message = err.message;
    }
    check("throws when every host is dead", Boolean(message));
    check("error names the provider", /moviesDrive/.test(message), message);
    check(
      "error explains the cause",
      /expired|blocked|failed to resolve/i.test(message),
      message,
    );
  });

  await section("moviesDrive: settings honoured", async () => {
    const { context, calls } = createContext({
      settings: { moviesDriveBaseUrl: "moviesdrives.mov" },
    });
    await md.posts.getPosts({
      filter: "",
      page: 1,
      providerValue: "moviesDrive",
      signal,
      providerContext: context,
    });
    check(
      "custom domain is normalised and used first",
      calls[0].url.startsWith("https://moviesdrives.mov"),
      calls[0].url,
    );
  });

  /* ================================================================ *
   * HDHub4u                                                           *
   * ================================================================ */
  await section("hdhub4u: getPosts", async () => {
    const { context } = createContext();
    const posts = await hh.posts.getPosts({
      filter: "",
      page: 1,
      providerValue: "hdhub4u",
      signal,
      providerContext: context,
    });
    check("returns posts", posts.length > 0, `${posts.length}`);
    check("finds the dual-audio movie", posts.some((p) => /Whisper Man/i.test(p.title)));
    check("finds the Hindi movie", posts.some((p) => /Alpha/i.test(p.title)));
    check("finds the series", posts.some((p) => /Mousetrap/i.test(p.title)));
    check(
      "WhatsApp banner is not a post",
      !posts.some((p) => /whatsapp/i.test(p.title) || /whatsapp/i.test(p.link)),
    );
    check(
      "category links are not posts",
      !posts.some((p) => /\/category\//.test(p.link)),
    );
    check("links stored relative", posts.every((p) => p.link.startsWith("/")));

    // Regression: the real markup puts the poster and the title in TWO
    // separate sibling anchors pointing at the same permalink. Keying off the
    // image and taking the container's first anchor returned an empty list.
    check(
      "merges the image-only and text anchors into one post",
      posts.length === 4,
      `${posts.length} (expected 4 - one per entry, not per anchor)`,
    );
    check(
      "no duplicate entries from the paired anchors",
      new Set(posts.map((p) => p.link)).size === posts.length,
    );
    check(
      "takes the descriptive title, not the shorter alt text",
      posts.some((p) => /Dual Audio|10Bit-HEVC/i.test(p.title)),
      posts.map((p) => p.title.slice(0, 40)).join(" | "),
    );
    check(
      "every post has a poster",
      posts.every((p) => /^https?:\/\//.test(p.image)),
    );
    check(
      "pagination links are not posts",
      !posts.some((p) => /^\/page\//.test(p.link)),
    );
    check(
      "older catalogue entries are picked up too",
      posts.some((p) => /Wanted/i.test(p.title)),
    );
  });

  await section("hdhub4u: poster is a sibling, not a child", async () => {
    // The live listing puts the <img> BESIDE the anchors, not inside them:
    //   <img alt="Title">  <a href="/slug/"></a>  <a href="/slug/">Title</a>
    // A selector that only does anchor.find("img") finds nothing, so every
    // post gets dropped for having no poster - the reported "no posts".
    const B = "https://new5.hdhub4u.cl";
    const html =
      `<html><body><ul>` +
      `<li><img src="https://image.tmdb.org/t/p/w342/a.jpg" alt="Mousetrap (Season 1)">` +
      `<a href="${B}/mousetrap-s1/"></a>` +
      `<a href="${B}/mousetrap-s1/">Mousetrap (Season 1) WEB-DL [Hindi] | NF Series</a></li>` +
      `<li><img src="https://imgshare.info/images/Okja-2017.jpg" alt="Okja (2017)">` +
      `<a href="${B}/okja-2017/"></a>` +
      `<a href="${B}/okja-2017/">Okja (2017) BluRay [Hindi] | Full Movie</a></li>` +
      `</ul><a href="${B}/category/hindi-dubbed/">Hindi Dubbed</a></body></html>`;

    const store = new Map();
    const get = async () => ({ status: 200, data: html, headers: {} });
    const providerContext = {
      axios: Object.assign(get, {
        get,
        post: async () => ({ status: 404, data: "", headers: {} }),
      }),
      cheerio: require("cheerio"),
      commonHeaders: {},
      openWebView: async () => {
        throw new Error("no webview");
      },
      kvStore: {
        get: async (k) => store.get(k),
        set: async (k, v) => void store.set(k, v),
        delete: async (k) => store.delete(k),
        keys: async () => Array.from(store.keys()),
        clear: async () => store.clear(),
      },
    };

    const out = await hh.posts.getPosts({
      filter: "",
      page: 1,
      providerValue: "hdhub4u",
      signal,
      providerContext,
    });
    check("finds posts when the poster is a sibling", out.length === 2, `${out.length}`);
    check(
      "posters are attached from the sibling img",
      out.every((p) => /^https?:\/\//.test(p.image)),
      out.map((p) => p.image).join(" "),
    );
    check(
      "titles come from the text anchor",
      out.some((p) => /Mousetrap/.test(p.title)) &&
        out.some((p) => /Okja/.test(p.title)),
    );
  });

  await section("hdhub4u: landing-page mirrors are rejected", async () => {
    // hdhub4u.bi/.ec/.ms answer 200 with marketing copy and no catalogue.
    // Accepting one would cache it and return an empty library forever.
    const { context, calls } = createContext({
      settings: { hdhub4uBaseUrl: "hdhub4u.bi" },
    });
    const posts = await hh.posts.getPosts({
      filter: "",
      page: 1,
      providerValue: "hdhub4u",
      signal,
      providerContext: context,
    });
    check(
      "still returns posts when pointed at a landing page",
      posts.length > 0,
      `${posts.length}`,
    );
    check(
      "fell through to a real content mirror",
      calls.some((c) => /new\d\.hdhub4u\.cl/.test(c.url)),
      calls.map((c) => c.url).join(" "),
    );
    check(
      "did not cache the landing page as the working mirror",
      (await context.kvStore.get("hdhub4uMirror")) !== "https://hdhub4u.bi",
      String(await context.kvStore.get("hdhub4uMirror")),
    );
  });

  await section("hdhub4u: search", async () => {
    const { context, calls } = createContext();
    const results = await hh.posts.getSearchPosts({
      searchQuery: "whisper man",
      page: 1,
      providerValue: "hdhub4u",
      signal,
      providerContext: context,
    });
    check("returns results", results.length > 0, `${results.length}`);
    check(
      "uses the WordPress ?s= search",
      calls.some((c) => /\?s=whisper%20man/.test(c.url)),
      calls.map((c) => c.url).join(" "),
    );

    const { context: c2, calls: paged } = createContext();
    await hh.posts.getSearchPosts({
      searchQuery: "alpha",
      page: 3,
      providerValue: "hdhub4u",
      signal,
      providerContext: c2,
    });
    check(
      "paging uses /page/N/ before the query",
      paged.some((c) => /\/page\/3\/\?s=alpha/.test(c.url)),
      paged.map((c) => c.url).join(" "),
    );
  });

  await section("hdhub4u: getMeta - movie (The Whisper Man)", async () => {
    const { context } = createContext();
    const info = await hh.meta.getMeta({
      link: "/the-whisper-man-2026-hindi-webrip-full-movie/",
      providerContext: context,
    });
    check("title parsed", /Whisper Man/i.test(info.title), info.title);
    check("typed as movie", info.type === "movie", info.type);
    check("imdbId extracted", info.imdbId === "tt11561116", info.imdbId);
    check("poster is TMDB, not a screenshot", /image\.tmdb\.org/.test(info.image), info.image);
    check("has quality options", info.linkList.length >= 4, `${info.linkList.length}`);
    check(
      "qualities detected from labels",
      ["480", "720", "1080", "2160"].every((q) =>
        info.linkList.some((l) => l.quality === q),
      ),
      info.linkList.map((l) => `${l.title}=${l.quality}`).join(" | "),
    );
    check(
      "all links are resolvable hosts (named host or redirector)",
      info.linkList.every((l) =>
        /hubdrive|hubcdn|hubcloud|\?id=/i.test(l.directLinks[0].link),
      ),
      info.linkList.map((l) => l.directLinks[0].link.slice(0, 34)).join(" | "),
    );
    check(
      "browser-only players are excluded",
      !info.linkList.some((l) =>
        /hdstream4u|hubstream/i.test(l.directLinks[0].link),
      ),
    );
  });

  await section("hdhub4u: gated download block", async () => {
    // The site withholds the DOWNLOAD LINKS section unless the request carries
    // the visitor cookie and an external referer. The page still renders
    // (title, poster, storyline), so getMeta silently found nothing to play.
    const { context, calls } = createContext();
    await hh.meta.getMeta({
      link: "/the-whisper-man-2026-hindi-webrip-full-movie/",
      providerContext: context,
    });
    const headers = (calls.find((c) => /hdhub4u/.test(c.url)) || {}).config
      ?.headers || {};
    check("sends the xla visitor cookie", /xla=s4t/.test(headers.Cookie || ""), String(headers.Cookie));
    check(
      "sends an external referer",
      /google\.com/.test(headers.Referer || ""),
      String(headers.Referer),
    );
  });

  await section("hdhub4u: redirector + player-only links", async () => {
    const { context } = createContext();
    const info = await hh.meta.getMeta({
      link: "/the-last-sunrise-2026-hindi-webrip-full-movie/",
      providerContext: context,
    });
    const all = info.linkList.flatMap((l) => l.directLinks || []);

    check("finds download links", info.linkList.length > 0, `${info.linkList.length}`);
    check(
      "keeps the ?id= redirector qualities",
      all.some((d) => /greenmountmotors|\?id=/i.test(d.link)),
      all.map((d) => d.link.slice(0, 40)).join(" | "),
    );
    check(
      "drops browser-only players (hdstream4u / hubstream)",
      !all.some((d) => /hdstream4u|hubstream/i.test(d.link)),
    );
    check(
      "covers 480p through 4K",
      ["480", "720", "1080", "2160"].every((q) =>
        info.linkList.some((l) => l.quality === q),
      ),
      info.linkList.map((l) => l.quality).join(","),
    );

    // A redirector must resolve to the real media file, not be handed over raw.
    const { context: sc } = createContext();
    const streams = await hh.stream.getStream({
      link:
        "https://inventoryidea.com/?r=aHR0cHM6Ly9odWJjZG4uc2JzL2RsLz9saW5rPWh0dHBzOi8vcHViLTg1ODBlYzRiMTAyMjRiYjE4NjUwNDRjMTc5YmRmYzdlLnIyLmRldi8yZTU2NzU2NTAyMDU4ZDkwY2UzZTc3YWY4ZjlmNDU3NA==",
      type: "movie",
      signal,
      providerContext: sc,
    });
    check("redirector resolves to a stream", streams.length > 0, `${streams.length}`);
    check(
      "decoded to the real CDN file",
      streams.some((s) => /r2\.dev|cloudflarestorage/i.test(s.link)),
      streams.map((s) => s.link.slice(0, 50)).join(" | "),
    );
    check(
      "no redirector url leaked as a stream",
      !streams.some((s) => /inventoryidea|greenmountmotors/i.test(s.link)),
    );
  });

  await section("hdhub4u: getMeta - series (Mousetrap S1)", async () => {
    const { context } = createContext();
    const info = await hh.meta.getMeta({
      link: "/mousetrap-season-1-hindi-webrip-all-episodes/",
      providerContext: context,
    });
    check("typed as series", info.type === "series", info.type);
    check("imdbId extracted", info.imdbId === "tt36996011", info.imdbId);
    check("grouped into quality rows", info.linkList.length > 0, `${info.linkList.length}`);
    check(
      "720p and 1080p rows present",
      info.linkList.some((l) => l.quality === "720") &&
        info.linkList.some((l) => l.quality === "1080"),
      info.linkList.map((l) => l.title).join(" | "),
    );

    const row720 = info.linkList.find((l) => l.quality === "720");
    check("720p row lists all three episodes", (row720.directLinks || []).length === 3, `${(row720.directLinks || []).length}`);
    check(
      "episodes numbered in order",
      row720.directLinks.map((d) => d.title).join(",") ===
        "Episode 1,Episode 2,Episode 3",
      row720.directLinks.map((d) => d.title).join(","),
    );
    check(
      "each episode is a distinct file",
      new Set(row720.directLinks.map((d) => d.link)).size === 3,
    );
    check(
      "season PACK archives excluded",
      !JSON.stringify(info.linkList).includes("/packs/"),
    );
    check(
      "episodes typed as series",
      row720.directLinks.every((d) => d.type === "series"),
    );
  });

  await section("hdhub4u: getStream - unwraps hubdrive", async () => {
    const { context, calls } = createContext();
    const streams = await hh.stream.getStream({
      link: "https://hubdrive.tips/file/2133030588",
      type: "movie",
      signal,
      providerContext: context,
    });
    check("returns streams", streams.length > 0, `${streams.length}`);
    check(
      "followed hubdrive to the real HubCloud file",
      calls.some((c) => /hubcloud\.cx\/drive\/26ljgtk1k1qqq16/.test(c.url)),
    );
    check(
      "resolved to a CDN file",
      streams.some((s) => /cloudflarestorage|pixeldrain|workers-cf/i.test(s.link)),
      streams.map((s) => s.link.slice(0, 60)).join(" | "),
    );
    check("no hubdrive landing pages leaked", !streams.some((s) => /hubdrive/.test(s.link)));
  });

  await section("hdhub4u: getStream - episode + download order", async () => {
    const { context } = createContext();
    const streams = await hh.stream.getStream({
      link: "https://hubdrive.tips/file/2051973742",
      type: "series",
      signal,
      providerContext: context,
    });
    check("episode resolves", streams.length > 0, `${streams.length}`);

    const { context: dl } = createContext();
    const downloads = await hh.stream.getStream({
      link: "https://hubdrive.tips/file/2051973742",
      type: "series",
      signal,
      providerContext: dl,
      isDownload: true,
    });
    check("download mode returns candidates", downloads.length > 0);
    check(
      "download mode is ordered highest quality first",
      Number(downloads[0].quality || 0) >=
        Number(downloads[downloads.length - 1].quality || 0),
      downloads.map((s) => s.quality).join(","),
    );
  });

  await section("hdhub4u: hubcdn is a redirector, not a HubCloud page", async () => {
    // This is link #0 on every movie page - the one the app plays first.
    // Despite the shared "hub" prefix, hubcdn.sbs/file/ is a bare 302 to an
    // encoded redirector, NOT a /drive/ page. Handing it to the hubcloud
    // extractor finds nothing and the whole title fails.
    const REDIRECTOR =
      "https://inventoryidea.com/?r=aHR0cHM6Ly9odWJjZG4uc2JzL2RsLz9saW5rPWh0dHBzOi8vcHViLTg1ODBlYzRiMTAyMjRiYjE4NjUwNDRjMTc5YmRmYzdlLnIyLmRldi8yZTU2NzU2NTAyMDU4ZDkwY2UzZTc3YWY4ZjlmNDU3NA==";

    const get = async (url) => {
      if (/hubcdn\.sbs\/file\//.test(url)) {
        // Mirrors the live 302: body is a stub, the target is the final url.
        return {
          status: 200,
          data: "Redirecting ..",
          headers: {},
          request: { responseURL: REDIRECTOR },
        };
      }
      return { status: 404, data: "", headers: {} };
    };

    const store = new Map();
    let streams = [];
    let message = "";
    try {
      streams = await hh.stream.getStream({
        link: "https://hubcdn.sbs/file/FDhLkHbY4wQTtgOccIrnN1K1S",
        type: "movie",
        signal,
        providerContext: {
          axios: Object.assign(get, {
            get,
            post: async () => ({ status: 404, data: "", headers: {} }),
            head: async () => ({ status: 200, data: "", headers: {} }),
          }),
          cheerio: require("cheerio"),
          commonHeaders: {},
          openWebView: async () => {
            throw new Error("no webview");
          },
          kvStore: {
            get: async (k) => store.get(k),
            set: async (k, v) => void store.set(k, v),
            delete: async (k) => store.delete(k),
            keys: async () => Array.from(store.keys()),
            clear: async () => store.clear(),
          },
        },
      });
    } catch (err) {
      message = err.message;
    }

    check("the first link on a movie page resolves", streams.length > 0, message);
    check(
      "followed the 302 and decoded the redirector",
      streams.some((s) => /r2\.dev|cloudflarestorage/i.test(s.link)),
      streams.map((s) => s.link.slice(0, 56)).join(" | "),
    );
    check(
      "no hubcdn/redirector url returned as a stream",
      !streams.some((s) => /hubcdn\.sbs\/file|inventoryidea/i.test(s.link)),
    );
    check(
      "carries the Referer the CDN needs",
      streams.every((s) => s.headers && s.headers.Referer),
    );
  });

  await section("hdhub4u: a dead first host does not sink the title", async () => {
    // Qualities are hosted independently. If link #0 is dead the provider must
    // keep trying the rest rather than giving up on the whole title.
    const get = async (url) => {
      if (/hubcdn\.sbs\/file\//.test(url)) {
        const err = new Error("Request failed with status code 404");
        err.response = { status: 404, data: "" };
        throw err;
      }
      if (/hubdrive\.tips/.test(url)) {
        return {
          status: 200,
          data: '<html><body><a href="https://hubcloud.cx/drive/ok1">[HubCloud Server]</a></body></html>',
          headers: {},
        };
      }
      if (/hubcloud\.cx\/drive\//.test(url)) {
        return {
          status: 200,
          data: "<html><body><script>var url='https://gamerxyt.com/hubcloud.php?host=hubcloud&id=ok1&token=t';</script></body></html>",
          headers: {},
        };
      }
      if (/gamerxyt/.test(url)) {
        return {
          status: 200,
          data: '<html><body><a class="btn btn-success btn-lg h6" href="https://f8.r2.cloudflarestorage.com/hub/ok?X-Amz-Signature=s">Download [FSL Server]</a></body></html>',
          headers: {},
        };
      }
      return { status: 404, data: "", headers: {} };
    };

    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      const url = typeof input === "string" ? input : input?.url;
      const res = await get(url).catch(() => ({ status: 404, data: "" }));
      return {
        ok: res.status < 400,
        status: res.status,
        url,
        headers: { get: () => null },
        text: async () => (typeof res.data === "string" ? res.data : ""),
        json: async () => ({}),
      };
    };

    const store = new Map();
    let streams = [];
    try {
      // meta.ts hands over one link at a time, so emulate the page order by
      // resolving the dead one first and then the healthy one.
      const ctx = {
        axios: Object.assign(get, {
          get,
          post: async () => ({ status: 404, data: "", headers: {} }),
          head: async () => ({ status: 200, data: "", headers: {} }),
        }),
        cheerio: require("cheerio"),
        commonHeaders: {},
        openWebView: async () => {
          throw new Error("no webview");
        },
        kvStore: {
          get: async (k) => store.get(k),
          set: async (k, v) => void store.set(k, v),
          delete: async (k) => store.delete(k),
          keys: async () => Array.from(store.keys()),
          clear: async () => store.clear(),
        },
      };
      await hh.stream
        .getStream({
          link: "https://hubcdn.sbs/file/dead",
          type: "movie",
          signal,
          providerContext: ctx,
        })
        .catch(() => undefined);
      streams = await hh.stream.getStream({
        link: "https://hubdrive.tips/file/2133030588",
        type: "movie",
        signal,
        providerContext: ctx,
      });
    } finally {
      global.fetch = originalFetch;
    }

    check("a healthy host still resolves", streams.length > 0, `${streams.length}`);
    check(
      "reaches the media file",
      streams.some((s) => /cloudflarestorage|r2\.dev/i.test(s.link)),
    );
  });

  await section("hdhub4u: site cookie must not reach file hosts", async () => {
    // The site-gate cookie (xla=s4t) belongs to hdhub4u only. The shared
    // hubcloud extractor injects its own bundle - including cf_clearance -
    // ONLY when headers.Cookie is unset, so forwarding the site cookie
    // suppressed the clearance and every host 403'd.
    const pages = {
      "hubdrive.tips":
        '<html><body><h5><a href="https://hubcloud.cx/drive/abc123">[HubCloud Server]</a></h5></body></html>',
      "hubcloud.cx":
        "<html><body><script>var url='https://gamerxyt.com/hubcloud.php?host=hubcloud&id=abc123&token=x';</script></body></html>",
      "gamerxyt.com":
        '<html><body><a class="btn btn-success btn-lg h6" href="https://f8.r2.cloudflarestorage.com/hub/abc?X-Amz-Signature=z">Download [FSL Server]</a></body></html>',
    };
    // Behaves like the real CDN: challenge unless cf_clearance is present.
    const get = async (url, cfg = {}) => {
      const cookie = (cfg.headers || {}).Cookie || "";
      if (/hubcloud|gamerxyt/.test(url) && !/cf_clearance/.test(cookie)) {
        const err = new Error("Request failed with status code 403");
        err.response = { status: 403, data: "challenge" };
        throw err;
      }
      for (const key of Object.keys(pages)) {
        if (url.includes(key)) return { status: 200, data: pages[key], headers: {} };
      }
      return { status: 404, data: "", headers: {} };
    };

    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      const url = typeof input === "string" ? input : input?.url;
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => null },
        text: async () => {
          for (const key of Object.keys(pages)) {
            if (String(url).includes(key)) return pages[key];
          }
          return "";
        },
        json: async () => ({}),
      };
    };

    const store = new Map();
    let streams = [];
    let message = "";
    try {
      streams = await hh.stream.getStream({
        link: "https://hubdrive.tips/file/2430087611",
        type: "movie",
        signal,
        providerContext: {
          axios: Object.assign(get, {
            get,
            post: async () => ({ status: 404, data: "", headers: {} }),
            head: async () => ({ status: 200, data: "", headers: {} }),
          }),
          cheerio: require("cheerio"),
          commonHeaders: {},
          openWebView: async () => {
            throw new Error("no webview");
          },
          kvStore: {
            get: async (k) => store.get(k),
            set: async (k, v) => void store.set(k, v),
            delete: async (k) => store.delete(k),
            keys: async () => Array.from(store.keys()),
            clear: async () => store.clear(),
          },
        },
      });
    } catch (err) {
      message = err.message;
    } finally {
      global.fetch = originalFetch;
    }

    check("resolves through the CDN challenge", streams.length > 0, message);
    check(
      "reaches the real media file",
      streams.some((s) => /cloudflarestorage|r2\.dev|pixeldrain/i.test(s.link)),
      streams.map((s) => s.link.slice(0, 50)).join(" | "),
    );
    check(
      "no intermediate page returned as a stream",
      !streams.some((s) => /hubdrive|gamerxyt|hubcloud\.cx\/drive/i.test(s.link)),
    );
  });

  await section("hdhub4u: resilience", async () => {
    const { context, calls } = createContext({ mirrorDown: true });
    const posts = await hh.posts.getPosts({
      filter: "",
      page: 1,
      providerValue: "hdhub4u",
      signal,
      providerContext: context,
    });
    check("survives a blocked primary domain", posts.length > 0, `${posts.length}`);
    check(
      "actually tried a different mirror",
      calls.some((c) => !c.url.startsWith("https://new5.hdhub4u.cl")),
    );

    const { context: dead } = createContext({ allHostsDead: true });
    let message = "";
    try {
      await hh.stream.getStream({
        link: "https://hubdrive.tips/file/2133030588",
        type: "movie",
        signal,
        providerContext: dead,
      });
    } catch (err) {
      message = err.message;
    }
    check("throws when every host is dead", Boolean(message));
    check("error names the provider", /hdhub4u/.test(message), message);
  });

  /* ================================================================ */
  restoreFetch();
  console.log(
    `\n${passed} passed, ${failed} failed` +
      (failures.length ? `\nfailing: ${failures.join(", ")}` : ""),
  );
  process.exit(failed ? 1 : 0);
})();
