/**
 * Live responses captured from net77.cc / net27.cc / tv.imgcdn.kim while the
 * provider was being written. They are replayed by mock-context.js so the
 * provider logic can be exercised in environments without egress to those
 * hosts (CI sandboxes, offline dev).
 *
 * Captured: 2026-08-27.
 */

const NF_SEARCH_STRANGER = {
  head: "Movies & TV",
  type: 0,
  searchResult: [
    { id: "80057281", t: "Stranger Things" },
    { id: "81621414", t: "The Stranger" },
    { id: "80029520", t: "Doctor Stranger" },
  ],
};

const NF_SEARCH_INCEPTION = {
  head: "Movies & TV",
  type: 0,
  searchResult: [{ id: "70131314", t: "Inception" }],
};

const PV_SEARCH_REACHER = {
  head: "Movies & TV",
  type: 0,
  searchResult: [
    { id: "0RTZ57DQ6PBHH29UN5JS7U7CW4", t: "REACHER", y: "2022", r: "Series" },
    {
      id: "0P52WN3GC5OHP25WVULFKF2OUD",
      t: "Jack Reacher",
      y: "2012",
      r: "2h 5m",
    },
  ],
  error: "",
};

const PV_SEARCH_A = {
  head: "Movies & TV",
  type: 0,
  searchResult: [
    { id: "0JRRRBF6EHQGI922OFJHDEDHO4", t: "ALPHA", y: "2026", r: "2h 22m" },
    { id: "0KC4UA7AEQAJ31QST1T3G235KD", t: "Alliance", y: "2026", r: "Series" },
  ],
  error: "",
};

/** Prime Video series - four seasons, episodes paged per season. */
const PV_POST_REACHER_SERIES = {
  status: "y",
  d_lang: "eng",
  title: "REACHER",
  year: "2022",
  ua: "U/A 18+ [A]",
  match: "IMDb 8",
  hdsd: "HD",
  type: "t",
  director: "Thomas Vincent, Sam Hill",
  short_cast: "Alan Ritchson, Malcolm Goodwin, Willa Fitzgerald",
  cast: "Alan Ritchson, Malcolm Goodwin, Willa Fitzgerald, Maria Sten",
  genre: "Action, Drama, Suspense",
  desc: "When retired Military Police Officer Jack Reacher is arrested for a murder he did not commit, he finds himself in the middle of a deadly conspiracy.",
  season: [
    { s: "1", id: "0RTZ57DQ6PBHH29UN5JS7U7CW4", ep: "8", sele: " selected" },
    { s: "2", id: "0KM1Z0B2EEM4SNVBEINBEI8BAT", ep: "8", sele: " selected" },
    { s: "3", id: "0H1T1C23B07HLZPPHJSSPMYSL7", ep: "8", sele: " selected" },
    { s: "4", id: "0K16R3PLUFGC2JUE457C26O4OD", ep: "5", sele: " selected" },
  ],
  episodes: [
    {
      complate: 0,
      id: "0LOZI9HQPQB1KUOESJZ00M9A89",
      t: "City of Brotherly Love",
      s: "S4",
      ep: "E1",
      ep_desc: "A chance encounter with a distraught stranger.",
      time: "46m",
    },
  ],
  nextPageShow: 0,
  nextPage: 2,
  runtime: "5 episodes",
  error: null,
};

/** Prime Video movie. */
const PV_POST_JACK_REACHER = {
  status: "y",
  d_lang: "eng",
  title: "Jack Reacher",
  year: "2012",
  ua: "U/A 16+",
  match: "IMDb 7",
  runtime: "2h 5m",
  hdsd: "HD",
  type: "m",
  director: "Christopher McQuarrie",
  short_cast: "Tom Cruise, Rosamund Pike, Richard Jenkins",
  cast: "Tom Cruise, Rosamund Pike, Richard Jenkins",
  genre: "Suspense",
  desc: "A homicide investigator digs deeper into a case involving a trained military sniper who shot five random victims.",
  episodes: [null],
  error: null,
};

const PV_EPISODES_S2 = {
  episodes: [
    {
      id: "0FIMMPWASW7MF5N1S3A92HS8HM",
      t: "ATM",
      s: "S2",
      ep: "E1",
      ep_desc: "Reacher and Neagley investigate the murder of a member of 110th.",
      complate: 0,
      time: "55m",
    },
    {
      id: "0NHZAPQTEGFHGOM3HVAB7EXUL3",
      t: "What Happens in Atlantic City",
      s: "S2",
      ep: "E2",
      ep_desc: "The investigation takes Reacher to Atlantic City.",
      complate: 0,
      time: "49m",
    },
    {
      id: "0SVKFT0JOF9NFHLCHJ4EN900SK",
      t: "Picture Says a Thousand Words",
      s: "S2",
      ep: "E3",
      ep_desc: "Reacher forges an uneasy alliance with a dogged detective.",
      complate: 0,
      time: "47m",
    },
  ],
  runtime: "8 episodes",
  year: "2022",
  nextPageShow: 0,
  nextPage: 2,
  nextPageSeason: "0KM1Z0B2EEM4SNVBEINBEI8BAT",
};

/**
 * playlist.php for a Prime Video episode. Signed `in=` token, real subtitle
 * tracks - this is what a healthy native response looks like.
 */
const PV_PLAYLIST_EPISODE = [
  {
    title: "ATM",
    sources: [
      {
        file: "/pv/hls/0FIMMPWASW7MF5N1S3A92HS8HM.m3u8?in=::f801c9fe::1787829620::su::F2",
        label: "Auto",
        type: "application/vnd.apple.mpegurl",
      },
      {
        file: "/pv/hls/0FIMMPWASW7MF5N1S3A92HS8HM.m3u8?q=1080p&in=::f801c9fe::1787829620::su::F2",
        label: "Full HD",
        type: "application/vnd.apple.mpegurl",
      },
      {
        file: "/pv/hls/0FIMMPWASW7MF5N1S3A92HS8HM.m3u8?q=720p&in=::f801c9fe::1787829620::su::F2",
        label: "Mid HD",
        type: "application/vnd.apple.mpegurl",
        default: "true",
      },
    ],
    tracks: [
      {
        kind: "captions",
        file: "//pv.subscdn.top/subs/0FIMMPWASW7MF5N1S3A92HS8HM/en-us.[CC].srt",
        label: "English  [CC]",
      },
      {
        kind: "captions",
        file: "//pv.subscdn.top/subs/0FIMMPWASW7MF5N1S3A92HS8HM/hi-in.srt",
        label: "हिन्दी",
      },
    ],
  },
];

const NF_PLAYLIST_INCEPTION = [
  {
    title: "1756297000",
    image: "https://imgcdn.kim/poster/1920/70131314.jpg",
    sources: [
      {
        file: "/hls/70131314.m3u8?in=unknown::su",
        label: "Full HD",
        type: "application/vnd.apple.mpegurl",
      },
      {
        file: "/hls/70131314.m3u8?q=720p&in=unknown::su",
        label: "Mid HD",
        type: "application/vnd.apple.mpegurl",
        default: "true",
      },
    ],
    tracks: [
      {
        kind: "captions",
        file: "//subs.nfmirrorcdn.top/files/70131314/70131314-en.srt",
        label: "English",
        language: "en",
      },
    ],
  },
];

/**
 * A master whose video variants are the shared guest placeholder (220884).
 * Audio tracks carry the real id, which is exactly why the placeholder check
 * only looks at the variant lines.
 */
const MASTER_PLACEHOLDER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="eng",NAME="English",DEFAULT=YES,URI="https://s10.nm-cdn7.top/files/0FIMMPWASW7MF5N1S3A92HS8HM/a/4/4.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="hin",NAME="Hindi",DEFAULT=NO,URI="https://s10.nm-cdn7.top/files/0FIMMPWASW7MF5N1S3A92HS8HM/a/11/11.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="aac",RESOLUTION=1920x1080,CLOSED-CAPTIONS=NONE
https://s21.freecdn4.top/files/220884/1080p/1080p.m3u8?in=unknown::su
#EXT-X-STREAM-INF:BANDWIDTH=600000,AUDIO="aac",DEFAULT=YES,RESOLUTION=1280x720,CLOSED-CAPTIONS=NONE
https://s21.freecdn4.top/files/220884/720p/720p.m3u8?in=unknown::su
#EXT-X-STREAM-INF:BANDWIDTH=400000,AUDIO="aac",RESOLUTION=854x480,CLOSED-CAPTIONS=NONE
https://s21.freecdn4.top/files/220884/480p/480p.m3u8?in=unknown::su`;

/** A healthy master: variants point at the title's own asset id. */
const MASTER_REAL = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="eng",NAME="English",DEFAULT=YES,URI="https://s13.freecdn2.top/files/0P52WN3GC5OHP25WVULFKF2OUD/a/2/2.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="aac",RESOLUTION=1920x1080,CLOSED-CAPTIONS=NONE
https://s13.freecdn2.top/files/0P52WN3GC5OHP25WVULFKF2OUD/1080p/1080p.m3u8?in=::842ff96f::su
#EXT-X-STREAM-INF:BANDWIDTH=600000,AUDIO="aac",DEFAULT=YES,RESOLUTION=1280x720,CLOSED-CAPTIONS=NONE
https://s13.freecdn2.top/files/0P52WN3GC5OHP25WVULFKF2OUD/720p/720p.m3u8?in=::842ff96f::su`;

const NEWTV_TOKEN = {
  // base64 of https://tv.imgcdn.kim
  token_hash: "aHR0cHM6Ly90di5pbWdjZG4ua2lt",
  doms: "false",
  mwin: "true",
  popwin: "true",
  var: "1.0",
};

const NEWTV_PLAYER = {
  status: "otp",
  ott: "pv",
  usertoken: "none",
  video_link: "https://tv.imgcdn.kim/newtv/hls/pv/0FIMMPWASW7MF5N1S3A92HS8HM.m3u8",
  referer: "https://net52.cc",
  title: "REACHER",
  ep: "E1 • S2",
  ep_title: "ATM",
};

const TMDB_SEARCH_TV_REACHER = {
  page: 1,
  results: [{ id: 108978, name: "Reacher", first_air_date: "2022-02-03" }],
};

const TMDB_SEARCH_MOVIE_JACK_REACHER = {
  page: 1,
  results: [{ id: 75780, title: "Jack Reacher", release_date: "2012-12-20" }],
};

/** net27 movie response - real signed MP4 renditions. */
const NET27_MOVIE = {
  ok: true,
  tmdbId: 75780,
  title: "Jack Reacher",
  year: "2012",
  imdb: "tt0790724",
  type: "movie",
  currentSeason: 1,
  currentEpisode: 1,
  mode: "proxy",
  mp4: "https://bcdnxw.hakunaymatata.com/resource/720.mp4?sign=aaa&t=1787828036",
  resolution: "720",
  streams: [
    {
      url: "https://bcdnxw.hakunaymatata.com/resource/360.mp4?sign=a&t=1",
      resolution: 360,
    },
    {
      url: "https://bcdnxw.hakunaymatata.com/resource/480.mp4?sign=b&t=2",
      resolution: 480,
    },
    {
      url: "https://bcdnxw.hakunaymatata.com/resource/720.mp4?sign=aaa&t=1787828036",
      resolution: 720,
    },
    {
      url: "https://bcdnxw.hakunaymatata.com/resource/1080.mp4?sign=c&t=3",
      resolution: 1080,
    },
  ],
  captions: [
    {
      lang: "en",
      name: "English",
      url: "https://net27-r2-cache.example.workers.dev/v1/1/s1/e1/sub.en.srt",
    },
  ],
};

/**
 * net27 for a series. Note `currentSeason`/`currentEpisode` come back as 1/1
 * no matter what season/episode was requested - the provider must refuse this
 * when the user asked for a different episode.
 */
const NET27_SERIES_S1E1 = Object.assign({}, NET27_MOVIE, {
  tmdbId: 108978,
  title: "Reacher",
  type: "tv",
  currentSeason: 1,
  currentEpisode: 1,
});

const NET27_NO_SOURCE = {
  ok: true,
  tmdbId: 27205,
  title: "Inception",
  type: "movie",
  noSource: true,
  error: "We couldn't find this title on NetMirror yet. Try a different one.",
};

const PV_HOME_HTML = `<!doctype html><html><body>
  <div class="tray-container">
    <article><a class="post-data" data-post="0RTZ57DQ6PBHH29UN5JS7U7CW4" title="REACHER">
      <img data-src="https://imgcdn.kim/pv/341/0RTZ57DQ6PBHH29UN5JS7U7CW4.jpg" alt="REACHER"></a></article>
    <article><a class="post-data" data-post="0GKY3CQGOYOPDSE76BWMJN5CK3" title="Fallout">
      <img data-src="https://imgcdn.kim/pv/341/0GKY3CQGOYOPDSE76BWMJN5CK3.jpg" alt="Fallout"></a></article>
  </div></body></html>`;

/** Landing page without data-post attributes - ids only in poster URLs. */
const PV_HOME_HTML_NO_DATAPOST = `<!doctype html><html><body>
  <div class="tray-container">
    <img src="https://imgcdn.kim/pv/341/0K50UKMPUYMBHQJ4QVK6L0AICH.jpg">
    <img src="https://imgcdn.kim/pv/341/0O70LSZ5KT12QBNQRUQGGRIWDP.jpg">
  </div></body></html>`;

const NF_HOME_HTML = `<!doctype html><html><body>
  <div class="tray-container">
    <article><a class="post-data" data-post="80057281" title="Stranger Things">
      <img data-src="https://imgcdn.kim/poster/v/80057281.jpg" alt="Stranger Things"></a></article>
  </div></body></html>`;

const MOBILE_WALL_HTML = `<html><body><h1>Site Direct Access Not Allowed in Mobiles</h1>
  <h2>Install NetMirror App for Unlimited Entertainment.</h2></body></html>`;

const INVALID_USER = { status: "n", error: "Invalid User" };

module.exports = {
  NF_SEARCH_STRANGER,
  NF_SEARCH_INCEPTION,
  PV_SEARCH_REACHER,
  PV_SEARCH_A,
  PV_POST_REACHER_SERIES,
  PV_POST_JACK_REACHER,
  PV_EPISODES_S2,
  PV_PLAYLIST_EPISODE,
  NF_PLAYLIST_INCEPTION,
  MASTER_PLACEHOLDER,
  MASTER_REAL,
  NEWTV_TOKEN,
  NEWTV_PLAYER,
  TMDB_SEARCH_TV_REACHER,
  TMDB_SEARCH_MOVIE_JACK_REACHER,
  NET27_MOVIE,
  NET27_SERIES_S1E1,
  NET27_NO_SOURCE,
  PV_HOME_HTML,
  PV_HOME_HTML_NO_DATAPOST,
  NF_HOME_HTML,
  MOBILE_WALL_HTML,
  INVALID_USER,
};
