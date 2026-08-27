# providers

Vega App provider extensions, based on the
[vega-org/providers-template](https://github.com/vega-org/providers-template) layout.

## Providers

| Provider | Value | Site |
| --- | --- | --- |
| YoMovies | `yomovies` | https://yomovies.energy |
| ExtraMovies | `extraMovies` | https://extramovies.miami |
| MovieBox Online | `movieBoxOnline` | https://movieboxonline.net |
| NetMirror | `net77` | https://net77.cc |

## YoMovies provider

`providers/yomovies/` contains:

- `client.ts` – shared HTTP layer. yomovies.energy sits behind Cloudflare and
  returns a 403 "Just a moment…" interstitial to plain requests, so every page
  fetch goes through `fetchPage()`, which detects the challenge and hands the
  url to `providerContext.openWebView` (`waitForCookie: "cf_clearance"`). The
  resulting cookie + user-agent are cached in `kvStore`, so the check is solved
  once and reused for later requests.

- `catalog.ts` – home catalog rows (Latest, Bollywood, Hollywood, Hindi Dubbed,
  South Special, Web Series, Dual Audio) plus a genre list.
- `posts.ts` – `getPosts` / `getSearchPosts`. Scrapes the PsyPlay theme
  `.ml-item` grid with fallback selectors and a final `-Watch-online-full-movie`
  anchor sweep. Paging uses `/page/N/`, search uses `/search/<query>/`.
- `meta.ts` – `getMeta`. Title, synopsis, poster, IMDb id, genres, cast, rating,
  and a `linkList` built from the player iframes (`Server 1..N`) and the
  download table (`#list-dl`). Titles containing "Season/Episode" are typed as
  `series`.
- `stream.ts` – `getStream`. Follows each embed (speedostream / netu style),
  unpacks `eval(function(p,a,c,k,e,d))` player scripts and returns every
  `.m3u8` / `.mp4` source with the right `Referer`/`Origin` headers.
  HLS is sorted first for playback, mp4 first when `isDownload` is true.
- `settings.ts` – custom domain/mirror override (`yomoviesBaseUrl`), surfaced
  in the app's Provider Manager.
- `utils.ts` – packed-player unpacking and video-url extraction helpers,
  plus URL-entity decoding and resolution sniffing.

### Playback gotchas (netu / speedostream CDN)

Media is served from a signed, adaptive CDN url such as
`https://<host>/hls2/01/00010/<id>_,l,h,x,.urlset/master.m3u8?t=<token>&s=...&e=21600`.
Three things must be right or the player shows nothing:

1. **Entity decoding** – page markup contains `&amp;` between query params.
   Leaving it in breaks the signed token and the CDN returns 403, so the URL
   must be decoded (`decodeUrlEntities`) before being handed to the player.
2. **Referer, but never `Origin`** – the media host differs from the embed
   host, and the token is validated against the *embed* origin (e.g.
   `speedostream1.com`), which the `Referer` on each stream carries. Sending an
   `Origin` header makes the CDN treat the request as a browser XHR and apply a
   CORS allow-list, so it answers 403 to the player's segment requests. A
   downloader issues a single plain GET and still succeeds - that asymmetry is
   exactly the "download works, streaming doesn't" failure mode.
3. **Adaptive masters** – `,l,h,x,.urlset/master.m3u8` is a multi-variant
   playlist, so no fixed `quality` is reported; the player selects a rendition.
   Query params (`e=21600`, `f=53245`) are excluded from resolution sniffing so
   they are not misread as `2160p`. The master is parsed and each
   `#EXT-X-STREAM-INF` rendition is also exposed as a selectable stream, so a
   player that cannot start the master has a concrete 1080p/720p/360p fallback.
   For playback the master is sorted first; for downloads the fixed renditions
   come first.

Signed links are also time-limited (`e=21600` = 6h), so they must be resolved
at playback time and cannot be bookmarked.

Failures are reported with `throwProviderError` (as in
[Zenda-Cross/vega-providers](https://github.com/Zenda-Cross/vega-providers))
instead of being swallowed into an empty list, so the app surfaces a real
message rather than a blank screen.

Because yomovies rotates domains, set **Custom Domain / Mirror URL** in the
provider settings if `yomovies.energy` stops resolving; every request derives
its base url from that value.

## Development

```bash
npm install
npm run build                              # bundle providers into dist/
npm run test -- yomovies                   # end-to-end test
npm run test:provider -- yomovies getPosts --rebuild
npm run dev                                # local dev server for the app
```

The site sits behind Cloudflare. The first browse in the app may pop the
verification WebView; after it clears, the `cf_clearance` cookie is cached and
browsing is seamless. Note that CLI tests (`npm run test:provider`) have no
WebView, so they will report the Cloudflare block instead of results.


## ExtraMovies provider

`providers/extraMovies/` targets a WordPress/GridShow site whose posts link out
to file hosts rather than embedded players.

- `catalog.ts` – Latest plus category rows (Bollywood, Hollywood, Dual Audio,
  Web Series, South) and a genre list.
- `client.ts` – shared fetch layer with the same Cloudflare `openWebView`
  solver and `cf_clearance` caching used by the yomovies provider, mirror
  override support, and WordPress thumbnail stripping (`-360x540.jpg` ->
  full-size poster).
- `posts.ts` – `getPosts` / `getSearchPosts`. Category paging is `/page/N/`;
  search is WordPress `?s=` (paged as `/page/N/?s=`). Taxonomy and utility
  URLs (`/category/`, `/tag/`, `/how-to-download/`) are filtered out so nav
  links never appear as results.
- `meta.ts` – title, poster (skipping screenshots/logos), IMDb id, rating,
  genres, cast and storyline. Info fields are read from individual block
  elements rather than the flattened page text, which keeps a value from
  running into the next heading. Each download heading becomes a `linkList`
  entry sorted best-quality-first; episode entries retain their `SxxExx`
  marker so a season's files stay distinguishable.
- `stream.ts` – routes each download link to the extractor that understands
  that host, then orders playable servers first for streaming (and
  download-optimised mirrors first for downloads). Exports
  `nonStreamableServer` so the app does not hand a download-only mirror to the
  video player.

### File hosts

ExtraMovies posts use different hosts depending on their age, so `stream.ts`
dispatches by hostname rather than assuming one:

| Host | Extractor |
| --- | --- |
| `hubcloud`, `hubdrive`, `vcloud`, `driveleech`, `driveseed` | `extractors/hubcloud.ts` |
| `gdflix`, `gdlink`, `gdtot` | `extractors/gdflix.ts` |
| `gofile.io` | `extractors/gofile.ts` |
| `filepress`, `filebee` | followed to whichever host above it wraps |

This matters because the layouts are completely different: newer posts link to
HubCloud, while older ones (e.g. the 2016 Deadpool post) link only to GDFlix
and FileBee. Sending a GDFlix page to the HubCloud extractor yields nothing.
All links on a post are collected and tried in priority order (HubCloud,
GDFlix, Gofile, then FilePress wrappers), so one dead host does not sink the
title.
- `settings.ts` – site mirror override (`extraMoviesBaseUrl`) and a HubCloud
  domain override (`extraMoviesHubcloudDomain`).

### HubCloud mirrors and "Network Error"

Download links point at HubCloud, which rotates domains (`hubcloud.art`,
`hubcloud.cx`, ...) and is frequently DNS-blocked by Indian ISPs. A blocked
host surfaces as an axios **"Network Error" with no HTTP response**, which is
distinct from a 4xx/5xx where the host answered.

`stream.ts` treats these differently:

* **Unreachable host** (DNS/TLS/timeout) – retries the same path across the
  known mirror domains, preferring any domain set in provider settings.
* **HTTP error or an empty result** – the mirror answered, so a sibling domain
  serving the same id would behave identically; it stops rather than spraying
  every mirror.

The two outcomes produce different, actionable errors: an ISP-blocking hint
(VPN / 1.1.1.1 DNS / set a working domain) versus "the upload was removed, try
another quality". If every domain is blocked for you, set a HubCloud domain
that opens in your browser under provider settings.

### Vendored extractors

`providers/extractors/{hubcloud,gofile}.ts` are copied from
[Zenda-Cross/vega-providers](https://github.com/Zenda-Cross/vega-providers).
They needed small type-only fixes to compile under this repo's `tsc --noEmit`
gate (the upstream build uses esbuild, which strips types without checking):
widening three `cleanHeaders` objects to `Record<string, string>` so keys can be
deleted, and dropping type arguments on untyped optional-chained `kvStore.get`
calls. Runtime behaviour is unchanged.


## MovieBox Online provider

`providers/movieBoxOnline/` targets a Nuxt front-end sitting on the shared
`wefeed-h5api-bff` backend (the same API family as the reference
`movieBoxWeb` provider in Zenda-Cross/vega-providers). Because the backend
returns JSON, this provider makes API calls rather than scraping markup, which
is far more stable than parsing a client-rendered SPA.

**Routes differ from the reference provider** - verified against the live site:

| Purpose | This site | Reference `movieBoxWeb` |
| --- | --- | --- |
| Detail page | `/movies/<detailPath>` | `/moviesDetail/<detailPath>` |
| Listing JSON | `/wefeed-h5api-bff/subject/trending` | same |
| Playback JSON | `/wefeed-h5api-bff/subject/play` | same |
| Subtitles | `/wefeed-h5api-bff/subject/caption` | same |

Reusing the reference `/moviesDetail/` path returns a 404 here, so the detail
URL is rebuilt from `detailPath`.

- `nuxt.ts` – the Nuxt payload decoder vendored from the reference provider.
  Listing/detail pages embed their state in `#__NUXT_DATA__` as an
  index-referenced array, so it must be hydrated before it can be read.
- `posts.ts` – Trending uses the JSON endpoint (paged). Movie/TV/Animation tabs
  read the rendered page's Nuxt state. Titles with `hasResource: false` are
  dropped so unplayable entries never reach the catalog.

### Search

`movieboxonline.net` has **no search of its own** - every candidate route
(`/search`, `/searchResult`, `/newWeb/searchResult`) returns the site's 404
page, and its JSON API exposes no search endpoint.

Note that a GET probe is not proof on this backend: the wefeed search API is
**POST-only**, so GET returns `404 page not found` even where a route exists.

`getSearchPosts` therefore cascades:

1. **POST** the known search endpoints against this domain, caching whichever
   one answers in `kvStore`. Uses `fetch` (the transport the reference
   `movieBoxWeb` provider uses for this backend) with an axios fallback.
2. **Sibling MovieBox deployments** (`officialmoviebox.com` and friends) that
   do serve `/newWeb/searchResult`. This is the mechanism the reference
   provider relies on. Results are keyed by `detailPath`, which is
   host-independent, so a title found on a mirror still plays through this
   domain's play API. The working origin is cached.
3. **Local match against trending** - a genuine last resort that only finds a
   title if it happens to be trending.

### Known limitations

Some titles return `hasResource: false` from the play API even when the catalog
advertises `hasResource: true` - these are region- or client-gated and produce a
clear error rather than a blank screen.

Search depends on a sibling deployment being reachable (step 2 above). If those
mirrors are blocked for you, search falls back to trending-only matching and
will legitimately return nothing for titles that are not currently trending.

---

## NetMirror provider

`providers/net77/` targets NetMirror (`net77.cc`), a mirror that re-serves the
Netflix and Prime Video catalogues. Everything is JSON, so this provider calls
APIs rather than scraping markup.

**The domain rotates.** NetMirror moves every few weeks
(`net22` → `net11` → `net27` → `net77` …). `net77.cc` is the mirror this was
built against; set a newer one in provider settings when it moves.

### Endpoints (verified against the live site)

Netflix lives at the root, Prime Video under `/pv`:

| Purpose | Netflix | Prime Video |
| --- | --- | --- |
| Search | `/search.php?s=&t=` | `/pv/search.php?s=&t=` |
| Details | `/post.php?id=&t=` | `/pv/post.php?id=&t=` |
| Episodes | `/episodes.php?s=&series=&t=&page=` | `/pv/episodes.php?…` |
| Playlist | `/playlist.php?id=&t=` | `/pv/playlist.php?id=&t=` |

The `/mobile/*` variants of these paths answer *"Site Direct Access Not Allowed
in Mobiles"* to a desktop user-agent, so the non-mobile paths are used.

### Guest session

`post.php` replies `{"status":"n","error":"Invalid User"}` without a session
cookie. Posting to `/verify.php` returns a `t_hash_t` cookie; the captcha field
is not validated server-side, which is the same handshake the official app
performs. The cookie is cached in `kvStore` for 12 h, and re-negotiated
automatically when the backend rejects it. If Cloudflare fronts the handshake,
it falls back to `openWebView` with `waitForCookie: "t_hash_t"`.

### Playback: the placeholder trap

This is the thing that makes or breaks the provider.

`playlist.php` happily returns a signed HLS master for any title, and it *looks*
correct - the audio tracks and subtitles carry the real content id. But for
titles that need an account, every **video** rendition points at a shared asset:

```
#EXT-X-MEDIA:TYPE=AUDIO,...,URI=".../files/0LOZI9HQ…/a/3/3.m3u8"   <- real title
#EXT-X-STREAM-INF:...,RESOLUTION=1920x1080
https://s21.freecdn4.top/files/220884/1080p/1080p.m3u8?in=unknown::su  <- decoy
```

`220884` is a ~10 minute "sign in to continue" reel. A provider that returns
this link reports success and then plays the wrong video. So every master is
fetched and checked before it is offered, and **only the variant lines are
inspected** - judging by the audio URIs would pass a placeholder manifest.

When the native master is a placeholder, `getStream` falls through:

1. **`playlist.php`** – adaptive HLS, multi-language audio, full subtitle list.
2. **NewTV API** – the flow the Android app uses. A rotating pool of
   `mobiledetect*` hosts returns a base64 `token_hash` naming the current media
   API (`/checknewtv.php` → `https://tv.imgcdn.kim`), which serves
   `/newtv/player.php?id=…`. Different host, so it sometimes works when the
   browser endpoint will not. Also verified against the placeholder.
3. **`net27.cc/api/embed-tmdb/<tmdbId>`** – progressive MP4s at 360/480/720/1080.
   Keyed by TMDB id, so the title is resolved through TMDB first (cached).

### Episode selection in the fallback

The MP4 API selects an episode with **`se`/`ep`**, not `s`/`e`:

```
/api/embed-tmdb/1396?type=tv&se=5&ep=14   -> currentSeason 5, currentEpisode 14
/api/embed-tmdb/1396?type=tv&s=5&e=14     -> currentSeason 1, currentEpisode 1
```

The abbreviated form is silently ignored and yields S1E1 — which would play the
wrong episode while reporting success. The provider therefore verifies that the
response echoes the requested season/episode, retries once with the legacy
names, and **returns nothing rather than the wrong episode** if it still
mismatches.

### Required playback headers

The CDNs (`*.nm-cdn*.top`, `*.freecdn*.top`) return 404 without a `Referer`, so
every returned stream carries one plus the `hd=on` cookie. No `Origin` is sent:
these hosts treat a request carrying one as a browser XHR and apply a CORS
allow-list. MP4 fallback links use `Referer: https://videodownloader.site/`,
which is what their anti-hotlink check accepts.

### Files

- `client.ts` – base URL/settings, guest session, the `*.php` request helpers,
  NewTV discovery, TMDB resolution, and the link-token codec.
- `catalog.ts` – Netflix / Prime Video rows plus alphabetical browse.
- `posts.ts` – `getPosts` / `getSearchPosts`. Search queries both catalogues and
  merges. Browse walks the alphabet through `search.php`, since the site has no
  numbered listing endpoint.
- `meta.ts` – `getMeta`. Also resolves `imdbId`/`tmdbId` from the title so the
  app can enrich the entry from Cinemeta (the site never exposes one).
- `episodes.ts` – `getEpisodes`, following `nextPageShow` pagination.
- `stream.ts` – `getStream`, implementing the three-stage cascade above.
- `settings.ts` – mirror override, MP4-fallback toggle, optional TMDB key.

### Tests

```bash
node tests/net77/run.js     # offline: replays captured responses
```

`tests/net77/` replays real responses captured from the live site, so the
placeholder detection, episode verification and header requirements are
exercised without network access. `tests/net77/live-check.js` is the online
counterpart: it hits the real site and probes each returned link to report
whether it actually serves media or the placeholder.

### Known limitations

Titles that NetMirror gates behind an account return the placeholder reel from
every native endpoint. Where the MP4 fallback also has no copy, `getStream`
raises a clear error instead of handing the player a decoy. Series episodes
depend on the fallback echoing the right episode, so a gated deep episode may
legitimately return nothing.
