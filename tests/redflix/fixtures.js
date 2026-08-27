/**
 * Live responses captured from redflix.club and the backends it delegates to
 * while this provider was written. Replayed by mock-context.js so the logic
 * can be exercised without egress to those hosts.
 *
 * Captured: 2026-08-27.
 */

/* ---------------------------------------------------------------- *
 * TMDB mirror (db.speedracelight.com) - keyless                      *
 * ---------------------------------------------------------------- */

const TRENDING = {
  page: 1,
  results: [
    {
      id: 1516698,
      title: "The Last Sunrise",
      media_type: "movie",
      poster_path: "/3PWJqDfygN0YNNjWsDUOXclCp3h.jpg",
      backdrop_path: "/tvY4QPyopLVaRkPVOQb3Y1dyy7f.jpg",
      release_date: "2026-08-26",
      vote_average: 7.975,
    },
    {
      id: 108978,
      name: "Reacher",
      media_type: "tv",
      poster_path: "/f1VCQIG2iCyOookdgOzwtUpwWC0.jpg",
      first_air_date: "2022-02-03",
      vote_average: 8.1,
    },
    // /trending also returns people, which must be filtered out.
    { id: 555, name: "Some Person", media_type: "person" },
  ],
};

const POPULAR_MOVIE = {
  page: 2,
  results: [
    {
      id: 840464,
      title: "Greenland 2: Migration",
      poster_path: "/z2tqCJLsw6uEJ8nJV8BsQXGa3dr.jpg",
      release_date: "2026-01-07",
    },
    {
      id: 687163,
      title: "Project Hail Mary",
      poster_path: "/yihdXomYb5kTeSivtFndMy5iDmf.jpg",
      release_date: "2026-03-15",
    },
  ],
};

const POPULAR_TV = {
  page: 1,
  results: [
    {
      id: 1396,
      name: "Breaking Bad",
      poster_path: "/anFx9aTOOYqgS3v7x3R84Kz67ly.jpg",
      first_air_date: "2008-01-20",
    },
  ],
};

const SEARCH_MULTI = {
  page: 1,
  results: [
    {
      id: 1396,
      name: "Breaking Bad",
      media_type: "tv",
      poster_path: "/anFx9aTOOYqgS3v7x3R84Kz67ly.jpg",
      first_air_date: "2008-01-20",
    },
    {
      id: 559969,
      title: "El Camino: A Breaking Bad Movie",
      media_type: "movie",
      poster_path: "/ePXuKdXZuJx8hHMNr2yM4jY2L7Z.jpg",
      release_date: "2019-10-11",
    },
    { id: 99, name: "Vince Gilligan", media_type: "person" },
  ],
};

const MOVIE_DETAIL = {
  id: 1516698,
  title: "The Last Sunrise",
  overview:
    "Ry, a college student with a chronic illness, escapes to Mallorca for the summer with her mother.",
  poster_path: "/3PWJqDfygN0YNNjWsDUOXclCp3h.jpg",
  backdrop_path: "/5lB7yPaRhJHQ9dx7AnvPUi0GZDU.jpg",
  release_date: "2026-08-26",
  runtime: 107,
  vote_average: 7.853,
  imdb_id: "tt37654096",
  genres: [{ name: "Romance" }, { name: "Drama" }],
  external_ids: { imdb_id: "tt37654096" },
  credits: {
    cast: [{ name: "Maia Reficco" }, { name: "Eva Longoria" }],
  },
};

const TV_DETAIL = {
  id: 1396,
  name: "Breaking Bad",
  overview:
    "Walter White, a New Mexico chemistry teacher, is diagnosed with Stage III cancer.",
  poster_path: "/anFx9aTOOYqgS3v7x3R84Kz67ly.jpg",
  backdrop_path: "/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
  first_air_date: "2008-01-20",
  vote_average: 8.949,
  genres: [{ name: "Drama" }, { name: "Crime" }],
  external_ids: { imdb_id: "tt0903747" },
  credits: { cast: [{ name: "Bryan Cranston" }, { name: "Aaron Paul" }] },
  seasons: [
    { season_number: 0, episode_count: 8, name: "Specials" },
    { season_number: 1, episode_count: 7, name: "Season 1" },
    { season_number: 2, episode_count: 13, name: "Season 2" },
    { season_number: 3, episode_count: 13, name: "Season 3" },
    // A future season with no episodes yet - must be dropped.
    { season_number: 6, episode_count: 0, name: "Season 6" },
  ],
};

const SEASON_3 = {
  air_date: "2010-03-21",
  episodes: [
    {
      episode_number: 1,
      season_number: 3,
      id: 62105,
      name: "No Más",
      overview: "Walt faces a new threat, on a new front.",
      still_path: "/g4taqxGFx9z8ovHhiaa2jvQFd0Z.jpg",
      air_date: "2010-03-21",
      runtime: 48,
    },
    {
      episode_number: 2,
      season_number: 3,
      id: 62106,
      name: "Caballo sin Nombre",
      overview: "Despite ever-increasing tension between Walt and Skyler.",
      still_path: "/eQYTr6cH834QyF3cE1VQymwolE1.jpg",
      air_date: "2010-03-28",
      runtime: 48,
    },
    {
      episode_number: 7,
      season_number: 3,
      id: 62111,
      name: "One Minute",
      overview: "Hank's increasing volatility forces a confrontation.",
      still_path: "/xxx.jpg",
      air_date: "2010-05-02",
      runtime: 47,
    },
    // Unaired - must be filtered out of the episode list.
    {
      episode_number: 99,
      season_number: 3,
      id: 999999,
      name: "Future Episode",
      overview: "Not out yet.",
      air_date: "2099-01-01",
    },
  ],
};

const EPISODE_S3E7 = {
  id: 62111,
  name: "One Minute",
  season_number: 3,
  episode_number: 7,
  air_date: "2010-05-02",
};

/** TMDB's shape when an episode genuinely does not exist. */
const EPISODE_NOT_FOUND = {
  success: false,
  status_code: 34,
  status_message: "The resource you requested could not be found.",
};

/* ---------------------------------------------------------------- *
 * Videasy (api.speedracelight.com + enc-dec.app)                     *
 * ---------------------------------------------------------------- */

const SEED = { seed: "59594629.LiLuXYQodANrCPpvjIoy6h", ttlMs: 30000 };

/** The backend answers plain JSON (not ciphertext) when the seed is stale. */
const SEED_INVALID = '{"error":"STREAMCRYPTO_SEED_INVALID"}';

const VIDEASY_ENCRYPTED = "a7f3e9c1b5d2" + "0".repeat(180);

const VIDEASY_DECRYPTED = {
  status: 200,
  result: {
    sources: [
      {
        url: "https://cdn.example-stream.net/hls/1516698/master.m3u8",
        quality: "1080",
      },
      {
        url: "https://cdn.example-stream.net/hls/1516698/720/index.m3u8",
        quality: "720",
      },
    ],
    subtitles: [
      { url: "https://sub.example.net/1516698/en.vtt", language: "English" },
      { url: "https://sub.example.net/1516698/es.srt", language: "Spanish" },
    ],
  },
};

/** `hdmovie` returns mixed-audio entries; `quality` doubles as the language. */
const VIDEASY_DECRYPTED_HDMOVIE = {
  status: 200,
  result: {
    sources: [
      {
        url: "https://cdn.example-stream.net/hdmovie/en/master.m3u8",
        quality: "English",
      },
      {
        url: "https://cdn.example-stream.net/hdmovie/hi/master.m3u8",
        quality: "Hindi",
      },
    ],
    subtitles: [],
  },
};

/* ---------------------------------------------------------------- *
 * VidFast (vidfast.vc + enc-dec.app)                                 *
 * ---------------------------------------------------------------- */

const VIDFAST_PAGE_HTML =
  '<!doctype html><html><body><script>self.__next_f.push([1,"' +
  '{\\"en\\":\\"ZmFrZS1lbmNyeXB0ZWQtYmxvYi1mb3ItdGVzdGluZw\\"}' +
  '"])</script></body></html>';

const VIDFAST_ENC = {
  status: 200,
  result: {
    servers: "https://vidfast.vc/abc123/dc80b31b/z/xbnwpdbcNDg/servers",
    stream: "https://vidfast.vc/abc123/dc80b31b/z/lxJHEpgIdFU",
    token: "OibZQtQ9kQqwB0CgstOo1btpWFGQa0kx",
  },
  info: "no update",
};

const VIDFAST_SERVERS_ENCRYPTED = "b2c4" + "1".repeat(120);

const VIDFAST_SERVERS_DECRYPTED = {
  status: 200,
  result: [
    { name: "vRapid", data: "srv-vrapid-001" },
    { name: "vFast", data: "srv-vfast-002" },
  ],
};

const VIDFAST_STREAM_ENCRYPTED = "c3d5" + "2".repeat(120);

const VIDFAST_STREAM_DECRYPTED = {
  status: 200,
  result: {
    sources: [
      {
        url: "https://cdn.vidfast-media.net/stream/1516698/2160/master.m3u8",
        quality: "2160",
      },
    ],
    subtitles: [
      { url: "https://sub.vidfast.net/1516698/en.vtt", label: "English" },
    ],
  },
};

/** A source that resolves but serves an error page instead of media. */
const VIDFAST_STREAM_DEAD = {
  status: 200,
  result: {
    sources: [
      { url: "https://cdn.vidfast-media.net/dead/expired.m3u8", quality: "720" },
    ],
    subtitles: [],
  },
};

/* ---------------------------------------------------------------- *
 * manifests / media bodies                                           *
 * ---------------------------------------------------------------- */

const MASTER_M3U8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720/index.m3u8`;

const MEDIA_M3U8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.000,
seg-1.ts
#EXTINF:6.000,
seg-2.ts
#EXT-X-ENDLIST`;

/** Valid #EXTM3U header but no variants and no segments - an empty shell. */
const EMPTY_M3U8 = `#EXTM3U
#EXT-X-VERSION:3`;

/* ---------------------------------------------------------------- *
 * redflix.club pages                                                 *
 * ---------------------------------------------------------------- */

const BROWSE_HTML = `<!doctype html><html><body>
  <h1>Search finished. 13 results.</h1>
  <a href="https://redflix.club/play?id=1396&type=tv">
    <img alt="Poster for Breaking Bad" src="https://image.tmdb.org/t/p/w342/anFx9aTOOYqgS3v7x3R84Kz67ly.jpg">
    <h2>Breaking Bad</h2>
  </a>
  <a href="https://redflix.club/play?id=1396&type=tv">
    <img alt="Still from Breaking Bad" src="https://image.tmdb.org/t/p/w780/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg">
  </a>
  <a href="https://redflix.club/play?id=559969&type=movie">
    <img alt="Poster for El Camino: A Breaking Bad Movie" src="https://image.tmdb.org/t/p/w185/ePXuKdXZuJx8hHMNr2yM4jY2L7Z.jpg">
  </a>
</body></html>`;

const BROWSE_HTML_EMPTY = `<!doctype html><html><body>
  <h1>Search finished. 0 results.</h1></body></html>`;

module.exports = {
  TRENDING,
  POPULAR_MOVIE,
  POPULAR_TV,
  SEARCH_MULTI,
  MOVIE_DETAIL,
  TV_DETAIL,
  SEASON_3,
  EPISODE_S3E7,
  EPISODE_NOT_FOUND,
  SEED,
  SEED_INVALID,
  VIDEASY_ENCRYPTED,
  VIDEASY_DECRYPTED,
  VIDEASY_DECRYPTED_HDMOVIE,
  VIDFAST_PAGE_HTML,
  VIDFAST_ENC,
  VIDFAST_SERVERS_ENCRYPTED,
  VIDFAST_SERVERS_DECRYPTED,
  VIDFAST_STREAM_ENCRYPTED,
  VIDFAST_STREAM_DECRYPTED,
  VIDFAST_STREAM_DEAD,
  MASTER_M3U8,
  MEDIA_M3U8,
  EMPTY_M3U8,
  BROWSE_HTML,
  BROWSE_HTML_EMPTY,
};
