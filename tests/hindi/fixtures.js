/**
 * Live responses captured from MoviesDrive and HDHub4u (and the file hosts they
 * hand off to) while these providers were written. Replayed by mock-context.js
 * so the logic can be exercised without egress to those hosts.
 *
 * Captured: 2026-08-29.
 */

/* ================================================================== *
 * MoviesDrive                                                         *
 * ================================================================== */

/** Home / category grid: anchor wrapping a poster image + title. */
const MD_LIST_HTML = `<!doctype html><html><body>
<div class="latest">
  <a href="https://new3.moviesdrive.christmas/the-whisper-man-2026-web-dl-hindi-dd5-1-english-480p-720p-1080p-2160p-4k-sdr-x264-esubs-full-movie/">
    <img src="https://image.tmdb.org/t/p/w400/6UqflU8Qqkz7Dq4swJPqs0ZJjY4.jpg"
         alt="The Whisper Man (2026) WEB-DL [Hindi (DD5.1) &amp; English] 480p | 720p | 1080p | Full Movie">
  </a>
  <a href="https://new3.moviesdrive.christmas/awarapan-2-2026/">
    <img src="https://image.tmdb.org/t/p/w500/l1rC9HMKvnKooIPVfNVN2Oukzx6.jpg"
         alt="Awarapan 2 (2026) [Hindi (Line)] HQ-HDTC 480p 720p 1080p | Full Movie">
  </a>
  <a href="https://new3.moviesdrive.christmas/reacher-season-1-4/">
    <img src="https://m.media-amazon.com/images/M/MV5BMTJkOWIx.jpg"
         alt="Download Reacher (Season 1 - 4) Dual Audio [ORG 5.1 Hindi + 5.1 English] WEB-DL">
  </a>
  <!-- chrome that must NOT become a post -->
  <a href="https://new3.moviesdrive.christmas/category/bollywood/"><img src="/logo.png" alt="Bollywood"></a>
  <a href="https://t.me/moviesdrivee"><img src="https://mdrive.lol/telegram.jpg" alt="Join Telegram"></a>
</div></body></html>`;

/** Typesense-backed search response (real shape, trimmed). */
const MD_SEARCH_JSON = {
  found: 5,
  page: 1,
  hits: [
    {
      document: {
        id: "9305",
        imdb_id: "",
        permalink: "/jawan-2023/",
        post_thumbnail:
          "https://cdn.bollywoodmdb.com/fit-in/movies/largethumb/2023/jawan/jawan-poster-2.jpg",
        post_title:
          "Download Jawan – Netflix (2023) Hindi ORG. DD5.1 [Extended Version] 480p [450MB] | 720p [1.5GB] | 1080p [3GB] |2160p 4k [20GB]WEB-DL",
      },
    },
    {
      document: {
        id: "26324",
        imdb_id: "tt30819853",
        permalink: "/raat-jawan-hai-season-1-2024/",
        post_thumbnail: "https://m.media-amazon.com/images/M/MV5BYTdlYWU4.jpg",
        post_title:
          "Download Raat Jawan Hai – Season 1 (2024) Complete Hindi WEB Series 480p | 720p | 1080p WEB-DL",
      },
    },
  ],
};

/** Movie detail page: quality headings, each followed by an mdrive archive link. */
const MD_MOVIE_HTML = `<!doctype html><html><body>
<h1>The Whisper Man (2026) WEB-DL [Hindi (DD5.1) &amp; English] 480p | 720p | 1080p | 2160p 4K SDR [x264/ESubs] | Full Movie</h1>
<p><a href="https://www.imdb.com/title/tt11561116/">iMDB Rating: 0.0/10</a></p>
<img src="https://image.tmdb.org/t/p/w400/6UqflU8Qqkz7Dq4swJPqs0ZJjY4.jpg" alt="Poster">
<img src="https://catimages.org/images/2026/08/28/vlcsnap-1.jpg" alt="Screenshot">
<a href="https://new3.moviesdrive.christmas/category/crime/">Crime</a>
<a href="https://new3.moviesdrive.christmas/category/thriller/">Thriller</a>
<p>Storyline: When his young son vanishes, a widower enlists help from his estranged father, a retired detective who put away the serial killer now linked to the case.</p>
<h5>The Whisper Man (2026) WEB-DL 480p x264 [438.43 MB]</h5>
<h5><a href="https://mdrive.lol/archive/17539/">480p x264 [438.43 MB]</a></h5>
<h5>The Whisper Man (2026) WEB-DL 720p x264 [1.12 GB]</h5>
<h5><a href="https://mdrive.lol/archive/17541/">720p x264 [1.12 GB]</a></h5>
<h5>The Whisper Man (2026) WEB-DL 1080p x264 [2.45 GB]</h5>
<h5><a href="https://mdrive.lol/archive/17543/">1080p x264 [2.45 GB]</a></h5>
<h5>The Whisper Man (2026) WEB-DL 4k 2160p WEB-DL SDR [14.4GB]</h5>
<h5><a href="https://mdrive.lol/archive/17524">4k 2160p WEB-DL SDR [14.4GB]</a></h5>
</body></html>`;

/** Series detail page: headings carry the season, links are per-season archives. */
const MD_SERIES_HTML = `<!doctype html><html><body>
<h1>Download Reacher (Season 1 – 4) Dual Audio [ORG 5.1 Hindi + 5.1 English] (S04 Ep05 Added) Amazon Original 480p | 720p | 1080p | 2160p WEB-DL</h1>
<p><a href="https://www.imdb.com/title/tt9288030/">IMDb Rating:- 8.0/10</a></p>
<img src="https://m.media-amazon.com/images/M/MV5BMTJkOWIx.jpg" alt="Poster">
<a href="https://new3.moviesdrive.christmas/category/action/">Action</a>
<p>Storyline- Reacher is an itinerant, homeless enormously strong individual with an inflexible personal code of ethics who visits a new town each season.</p>
<h5>Season 4 [Ep05 Added] [Hindi – English] 720p x264 [500MB/E]</h5>
<h5><a href="https://mdrive.lol/archive/15688/">720p Single Episode</a></h5>
<h5>Season 3 [Complete] {Hindi-English} 720p WEB-DL x264 [350MB/E]</h5>
<h5><a href="https://mdrive.lol/archive/6785/">720p Single Episode</a></h5>
<h5><a href="https://mdrive.lol/archive/6799/">720p Zip [2.5GB]</a></h5>
<h5>Season 1 [ORG 5.1 Hindi + 5.1 English] 720p WEB-DL x264 [450MB/E]</h5>
<h5><a href="https://mdrive.lol/archive/6759/">720p Single Episode</a></h5>
<h5><a href="https://mdrive.lol/archive/6766/">720p Zip[3.6GB]</a></h5>
</body></html>`;

/** Archive page for a movie: one file-host link per mirror. */
const MD_ARCHIVE_MOVIE_HTML = `<!doctype html><html><body>
<h5>Download LINKS</h5>
<h5><a href="https://hubcloud.cx/drive/1lexxynnjmxkg8j"><img src="/hubcloud.png"></a></h5>
<h5><a href="https://gdflix.dev/file/coyPfHyFJbvWGsk"><img src="/gdflix.png"></a></h5>
</body></html>`;

/** Archive page for a season: an EP heading per episode, two hosts each. */
const MD_ARCHIVE_SERIES_HTML = `<!doctype html><html><body>
<h5>Season 4 [Hindi – English] 720p 10Bit [300MB/E]</h5>
<h5>EP01 – 720p [313.32 MB]</h5>
<h5><a href="https://hubcloud.cx/drive/94ruuky3j1rjmym">HubCloud</a></h5>
<h5><a href="https://gdflix.dev/file/N3y9JMlMdT36jNA">GDFliX</a></h5>
<h5>EP02 – 720p [314.69 MB]</h5>
<h5><a href="https://hubcloud.cx/drive/yn2vp8yuvymvubs">HubCloud</a></h5>
<h5><a href="https://gdflix.dev/file/FWXWEx4XA7iCDCa">GDFliX</a></h5>
<h5>EP03 – 720p [253.24 MB]</h5>
<h5><a href="https://hubcloud.cx/drive/fvpksj1qkr0ydeu">HubCloud</a></h5>
<h5><a href="https://gdflix.dev/file/BiLOEGDzGXOrNgN">GDFliX</a></h5>
</body></html>`;

/* ================================================================== *
 * HDHub4u                                                             *
 * ================================================================== */

/**
 * Listing page. Mirrors the real DOM exactly: each entry has TWO anchors to
 * the same permalink - an image-only one (empty text) followed by the text
 * one carrying the title. Getting this wrong is what made getPosts return an
 * empty array against the live site.
 */
const HH_LIST_HTML = `<!doctype html><html><body>
<nav>
  <a href="https://new5.hdhub4u.cl/category/bollywood-movies/">BollyWood</a>
  <a href="https://new5.hdhub4u.cl/category/action-movies/">Action</a>
  <a href="https://new5.hdhub4u.cl/disclaimer/">Disclaimer</a>
</nav>
<ul>
  <li>
    <a href="https://new5.hdhub4u.cl/the-whisper-man-2026-hindi-webrip-full-movie/"><img src="https://image.tmdb.org/t/p/w342/oFEnDAN1tFEvPqpOKhNTAPw2NeH.jpg" alt="The Whisper Man (2026) WEB-DL [Hindi (DD5.1) &amp; English] 4K 1080p 720p &amp; 480p Dual Audio | Full Movie"></a>
    <a href="https://new5.hdhub4u.cl/the-whisper-man-2026-hindi-webrip-full-movie/">The Whisper Man (2026) WEB-DL [Hindi (DD5.1) &amp; English] 4K 1080p 720p &amp; 480p Dual Audio [x264/10Bit-HEVC] | Full Movie</a>
  </li>
  <li>
    <a href="https://new5.hdhub4u.cl/alpha-2026-hindi-webrip-full-movie/"><img src="https://image.tmdb.org/t/p/w342/nuLMioRauQacj4bRXRsJX9Oe5H6.jpg" alt="Alpha (2026)"></a>
    <a href="https://new5.hdhub4u.cl/alpha-2026-hindi-webrip-full-movie/">Alpha (2026) DS4K WEB-DL [Hindi DD5.1] 4K 1080p 720p &amp; 480p | Full Movie</a>
  </li>
  <li>
    <a href="https://new5.hdhub4u.cl/mousetrap-season-1-hindi-webrip-all-episodes/"><img src="https://image.tmdb.org/t/p/w342/dXpDkHr8mUAabDVPoEstJ3gzSf6.jpg" alt="Mousetrap (Season 1)"></a>
    <a href="https://new5.hdhub4u.cl/mousetrap-season-1-hindi-webrip-all-episodes/">Mousetrap (Season 1) WEB-DL [Hindi (DD5.1) &amp; English] | [ALL Episodes] | NF Series</a>
  </li>
  <li>
    <a href="https://new5.hdhub4u.cl/wanted-2009-bluray-hindi-full-movie/"><img src="https://imgshare.info/images/2026/08/24/Wanted-2009.jpg" alt="Wanted (2009)"></a>
    <a href="https://new5.hdhub4u.cl/wanted-2009-bluray-hindi-full-movie/">Wanted (2009) BluRay [Hindi DD5.1] 1080p 720p &amp; 480p [x264] | Full Movie</a>
  </li>
  <li>
    <a href="https://whatsapp.com/channel/0029VbC1T9JChq6LbeQ6uh39"><img src="https://myimg.click/images/joinwhatsapp-1.png" alt="Join WhatsApp"></a>
  </li>
</ul>
<div class="pagination">
  <a href="https://new5.hdhub4u.cl/page/2/">2</a>
  <a href="https://new5.hdhub4u.cl/page/172/">172</a>
</div>
<footer><a href="https://hdhub4u.download/">HDHub4u.Tv</a></footer>
</body></html>`;

/**
 * One of the SEO landing pages that share the brand (hdhub4u.bi/.ec/.ms).
 * Answers 200 with real HTML but carries no catalogue at all - the reason
 * they must never be used as content mirrors.
 */
const HH_LANDING_HTML = `<!doctype html><html><head><title>HDHub4u</title></head><body>
<img src="https://hdhub4u.bi/hdhub4ulogo.webp" alt="hdhub4u">
<h1>HDHub4u : The Best Free Site for Movie Lovers</h1>
<p>HDHub4u is the ultimate destination for movie lovers in the Indian
subcontinent, offering a wide range of films in various languages and quality
options. Whether you are looking to download the latest Bollywood hits,
regional films, or international blockbusters, here is why HDHub4u stands out
as a top choice. The platform offers multiple mirror sites for downloading
movies, including Google Drive, Indishare, and Clicknupload.</p>
<a href="https://hdhub4u.ms/">HDHub4u</a>
<p>Thank you! &copy; HDHub4u All rights reserved.</p>
</body></html>`;

const HH_MOVIE_HTML = `<!doctype html><html><body>
<h1>The Whisper Man (2026) WEB-DL [Hindi (DD5.1) &amp; English] 4K 1080p 720p &amp; 480p Dual Audio [x264/10Bit-HEVC] | Full Movie</h1>
<a href="https://new5.hdhub4u.cl/category/crime/">Crime</a>
<a href="https://new5.hdhub4u.cl/category/dual-audio/">Dual Audio</a>
<img src="https://image.tmdb.org/t/p/w500/oFEnDAN1tFEvPqpOKhNTAPw2NeH.jpg" alt="Poster">
<img src="https://catimages.org/images/vlcsnap-1.th.jpg" alt="Screenshot">
<p><a href="https://www.imdb.com/title/tt11561116/">iMDB Rating: x/10</a></p>
<p>Storyline: When his young son vanishes, a widower enlists help from his estranged father, a retired detective who put away the serial killer now linked to the case.</p>
<h3><a href="https://hubcdn.sbs/file/1IWMsG2XQqxaiFXEwtKxEnAT6">480p⚡[440MB]</a></h3>
<h4><a href="https://hubdrive.tips/file/2133030588">720p 10Bit HEVC [860MB]</a></h4>
<h4><a href="https://hubdrive.tips/file/9423583613">1080p WEB-DL [7.6GB]</a></h4>
<h4><a href="https://hubdrive.tips/file/7321886410">4K [2160p SDR WEB-DL – 14.4GB]</a></h4>
<h4><a href="https://hdstream4u.com/file/vfxapuaw979l">WATCH</a></h4>
</body></html>`;

/** Series page: per-episode headings, each with 720p/1080p Drive + Instant. */
const HH_SERIES_HTML = `<!doctype html><html><body>
<h1>Mousetrap (Season 1) WEB-DL [Hindi (DD5.1) &amp; English] 4K 1080p 720p &amp; 480p [x264/10Bit-HEVC] | [ALL Episodes] | NF Series</h1>
<a href="https://new5.hdhub4u.cl/category/web-series/">WEB-Series</a>
<img src="https://image.tmdb.org/t/p/w500/dXpDkHr8mUAabDVPoEstJ3gzSf6.jpg" alt="Poster">
<p><a href="https://www.imdb.com/title/tt36996011/">iMDB Rating: x/10</a></p>
<p>Storyline: A detective hunts a killer through a labyrinth of lies.</p>
<h4><a href="https://hubdrive.tips/packs/chimiuqv">1080p WEB-DL PACK [27.2GB]</a></h4>
<h4><a href="https://hubdrive.tips/packs/ogsdyvlw">4K [2160p SDR WEB-DL PACK – 71.8GB]</a></h4>
<h4>EPiSODE 1</h4>
<h4>720p –<a href="https://hubdrive.tips/file/2051973742">Drive</a> | <a href="https://hubcdn.sbs/file/Q2svtsNGNeyXWw5vbRrCOLVLC">Instant</a></h4>
<h4>1080p – <a href="https://hubdrive.tips/file/2190310177">Drive</a> | <a href="https://hubcdn.sbs/file/qIzrSVTTDfYHqK5kaYltkGm32">Instant</a></h4>
<h4>EPiSODE 2</h4>
<h4>720p –<a href="https://hubdrive.tips/file/2174449151">Drive</a> | <a href="https://hubcdn.sbs/file/Wxc7vFDeDW2uUuFJhNFGOP5qp">Instant</a></h4>
<h4>1080p – <a href="https://hubdrive.tips/file/2132068554">Drive</a> | <a href="https://hubcdn.sbs/file/NAcNxlJ8klwDbZKpAaxvXzpvt">Instant</a></h4>
<h4>EPiSODE 3</h4>
<h4>720p –<a href="https://hubdrive.tips/file/1838108118">Drive</a> | <a href="https://hubcdn.sbs/file/S2TgnqUZzLFr6z5HouMiLOLot">Instant</a></h4>
<h4>1080p – <a href="https://hubdrive.tips/file/2916929818">Drive</a> | <a href="https://hubcdn.sbs/file/fCAPFFI9M9ePRqQsqF4QeoPvf">Instant</a></h4>
</body></html>`;

/** hubdrive landing page -> real HubCloud file (verified live). */
const HH_HUBDRIVE_HTML = `<!doctype html><html><body>
<h6>The.Whisper.Man.2026.720p.10Bit.WEB-DL.Hindi.5.1-English.HEVC.x265-HDHub4u.Ms.mkv</h6>
<table><tr><td>File Size</td><td>862.44 MB</td></tr></table>
<h5><a href="https://hubcloud.cx/drive/26ljgtk1k1qqq16">[HubCloud Server]</a></h5>
<a href="https://hubcloud.cx/tg/go?id=3Ofp3dyu">Telegram File</a>
</body></html>`;

/** What the shared hubcloud extractor yields once it resolves a file. */
const HUBCLOUD_STREAMS = [
  {
    server: "HubCloud FSL",
    link: "https://f84f84ad3e96247f5d132e50e25ace74.r2.cloudflarestorage.com/hub/b214d3eb?X-Amz-Signature=92e1",
    type: "mkv",
    quality: "720",
    headers: { Referer: "https://hubcloud.cx/" },
  },
  {
    server: "HubCloud 10Gbps",
    link: "https://gpdl.hubcloud.cx/?id=41cde58790ded793f683e9a7ce",
    type: "mkv",
    headers: { Referer: "https://hubcloud.cx/" },
  },
];

const GDFLIX_STREAMS = [
  {
    server: "GDFlix Instant",
    link: "https://instant.busycdn.xyz/1ed32dffdfd27512334b51b3?bytes=1202555782",
    type: "mkv",
    quality: "720",
    headers: { Referer: "https://gdflix.dev/" },
  },
];

module.exports = {
  MD_LIST_HTML,
  MD_SEARCH_JSON,
  MD_MOVIE_HTML,
  MD_SERIES_HTML,
  MD_ARCHIVE_MOVIE_HTML,
  MD_ARCHIVE_SERIES_HTML,
  HH_LIST_HTML,
  HH_LANDING_HTML,
  HH_MOVIE_HTML,
  HH_SERIES_HTML,
  HH_HUBDRIVE_HTML,
  HUBCLOUD_STREAMS,
  GDFLIX_STREAMS,
};
