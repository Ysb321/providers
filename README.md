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
| Redflix | `redflix` | https://redflix.club |
| MoviesDrive | `moviesDrive` | https://moviesdrives.mov |
| HDHub4u | `hdhub4u` | https://hdhub4u.bi |

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

---

## Redflix provider

`providers/redflix/` targets Redflix (`redflix.club`). Unlike the other
providers here, Redflix **hosts no media of its own**: it is a Next.js
front-end keyed entirely on TMDB ids that embeds third-party players. Every
catalogue tile links to `/play?id=<tmdbId>&type=movie|tv`, and the playback
page offers ~14 switchable sources (VidPlay, Fast, Hindi, Redflix, Cinezo,
Orion, Premium, Vidgod, Bolt, Mega, Nova, Alpha, ...).

So this provider scrapes Redflix for *discovery* and resolves *playback*
through the same embed backends the site itself uses.

### Endpoints (verified live)

Redflix's own pages:

| Purpose | Path | Notes |
| --- | --- | --- |
| Home rails | `/` | TMDB ids in `/play?id=` links |
| Movies grid | `/movies` | infinite scroll |
| TV grid | `/tv-shows` | infinite scroll |
| Search | `/browse?q=` | 13 hits for "breaking bad" |
| Playback | `/play?id=&type=&season=&episode=` | S3E7 renders correctly |

`robots.txt` names `redflix.co` as the canonical domain and disallows
`/play`, `/movies`, `/tv-shows`, `/browse` and `/api/`. There is no public
JSON API on the site itself — `/api/*` and `/tv`, `/search` all 404.

**Pagination gotcha:** `/movies?page=2` returns page 1 again (verified) — the
grids are infinite-scroll, not query-paged. Catalogue paging therefore goes
through the keyless TMDB mirror the embed backend already uses:

| Purpose | Endpoint |
| --- | --- |
| Trending | `db.speedracelight.com/3/trending/{all\|movie\|tv}/day?page=` |
| Lists | `/3/{movie\|tv}/{popular\|top_rated\|...}?page=` |
| Genres | `/3/discover/{movie\|tv}?with_genres=&page=` |
| Search | `/3/search/multi?query=&page=` |
| Detail | `/3/{movie\|tv}/{id}?append_to_response=external_ids,credits` |
| Season | `/3/tv/{id}/season/{n}` |
| Episode | `/3/tv/{id}/season/{n}/episode/{e}` |

No API key is required on that mirror. Search still prefers Redflix's own
`/browse?q=` page, because Redflix only lists titles it can actually play; the
mirror is the fallback when the site is unreachable.

### Playback

Two source families are resolved in parallel, both plain HTTP:

**Videasy** (`api.speedracelight.com`) — eight upstream servers behind one API
(Yoru/cdn, Breach/m4uhd, Neon/vsrc, Vyse+Fade/hdmovie, Killjoy/meine,
Omen/lamovie, Raze/superflix), covering Original, Hindi, German, Spanish and
Portuguese audio.

```
GET /seed?mediaId={tmdbId}                    -> { seed, ttlMs: 30000 }
GET /{server}/sources-with-title?title=&mediaType=&year=
      &episodeId=&seasonId=&tmdbId=&imdbId=&enc=2&seed=   -> ciphertext
POST enc-dec.app/api/dec-videasy {text,id,seed}           -> sources+subtitles
```

Two things bite here. The **seed is IP-bound and expires in ~30 s**, so it is
fetched immediately before the source calls that consume it (a stale seed comes
back as plain `{"error":"STREAMCRYPTO_SEED_INVALID"}`, which is detected rather
than fed to the decryptor). And the **title must be double URL-encoded** —
`Game of Thrones` → `Game%2520of%2520Thrones`.

**VidFast** (`vidfast.vc`; `vidfast.pro` 302s there) — scrape the inline
`"en"`/`"token"` blob from the player page, `enc-vidfast` it into
`{servers, stream, token}`, POST `servers` with `X-CSRF-Token`, decrypt the
server list, then POST `stream/{data}` per server and decrypt again.

Both families return AES/WASM-encrypted payloads. That crypto cannot run in the
provider sandbox (no `crypto`, no WASM, no `Buffer`), so decoding is delegated
to the public `enc-dec.app` helper — the same service the upstream `autoEmbed`
provider uses. It is overridable in settings for anyone self-hosting
[EncDecEndpoints](https://github.com/smy778/EncDecEndpoints).

### Getting the right episode, and only real links

Two guards do the heavy lifting:

1. **Episode identity is checked against TMDB first.** Aggregators commonly
   fall back to S1E1 (or the pilot) when an episode is unknown, which plays the
   wrong thing while reporting success. Before any embed provider is asked,
   `/3/tv/{id}/season/{s}/episode/{e}` must exist *and* echo back the same
   season/episode. Verified live: S3E7 returns "One Minute" with
   `episode_number: 7`, while S3E42 returns `{"success":false}`.
2. **Every returned link is fetched before it is offered.** HLS must come back
   as a real `#EXTM3U` carrying variants or segments — a body that parses but
   contains neither is an empty shell and is dropped. Progressive files are
   range-requested and rejected if the response is `text/html` (an error page
   rather than video). If nothing survives, `getStream` throws instead of
   handing the player a dead link.

Streams carry `Referer` and a browser UA but deliberately **no `Origin`**:
these CDNs treat a request carrying one as a browser XHR and apply a CORS
allow-list, answering 403 to the player's segment requests while a one-shot
download still succeeds — the classic "download works, streaming doesn't" trap.

### Conflicts with reference implementations

- **`ythd.org/embed/{tmdbId}` is movie-only.** The `mediaflow-proxy` VidFast
  extractor (Python and Rust ports both) parses the TMDB id out of the URL and
  always requests `/embed/{id}`, discarding season/episode. Live,
  `ythd.org/embed/1396` returns **Mirror (1975)** — a film — not Breaking Bad,
  because that path treats the id as a *movie* id. TV needs
  `/embed/tv/{id}/{s}/{e}`. Ported as-is, that extractor silently serves an
  unrelated film for every TV request. This provider does not use that chain.
- **`vidlink.pro/api/b/...` is dead.** The widely-copied VidLink extractor
  (AES-256-CBC with a hard-coded key) returns `null` for both movie and TV
  today, so VidLink is not wired up.
- **`Zenda-Cross/vega-providers`' `autoEmbed`** was the most useful reference —
  the Videasy server table and the enc-dec flow follow it. Its use of the
  global `fetch` and its `cineby.at` origin were replaced with the injected
  `axios` and the player origins this site actually uses.
- **`redflix.py` (TVBox spiders)** targets `redflix.co` and only ever returns
  embed *page* URLs (`parse: 1`) for an external player to render — not
  playable media, so it could not be used directly.

### Files

- `client.ts` – endpoints, settings, HTTP helpers, link-token codec.
- `catalog.ts` – trending/popular/top-rated rows plus TMDB genre rows.
- `posts.ts` – `getPosts` / `getSearchPosts` (site search, TMDB fallback).
- `meta.ts` – `getMeta`, including `imdbId` for Cinemeta enrichment.
- `episodes.ts` – `getEpisodes`; unaired episodes are filtered out.
- `stream.ts` – `getStream`: episode check, both source families, verification.
- `settings.ts` – mirror override, per-source toggles, verification toggle,
  decryption-helper URL.

### Tests

```bash
npm run test:redflix        # offline: replays captured responses (93 assertions)
npm run test:redflix:live   # online: probes each link for real media
```

The live script additionally resolves two different episodes of the same show
and warns if they come back as the same file — the check that catches a backend
silently serving one episode for all of them.

### Known limitations

Redflix carries no media itself, so availability is entirely down to the embed
backends. Titles missing from their libraries produce a clear error rather than
a dead link. The Videasy seed is IP-bound with a ~30 s TTL, so playback must be
resolved from the same network that will fetch the stream; the app satisfies
this naturally, but a proxy between resolution and playback will not.

Only Videasy and VidFast are wired up. The remaining sources exposed on the
Redflix player each need their own reverse-engineering and are not implemented;
VidLink is stubbed out entirely because its API is currently dead.

---

## Hindi providers (MoviesDrive, HDHub4u)

`providers/moviesDrive/` and `providers/hdhub4u/` are Hindi-first catalogues:
Bollywood, Hindi-dubbed Hollywood, South Hindi dubs, and dual-audio web series.
Both are WordPress sites that publish **download links to file hosts** rather
than hosting media, so both reuse this repo's existing
`providers/extractors/{hubcloud,gdflix,gofile}.ts` for the final hop.

Chosen over the other candidates because their link chains resolve without a
human-verification wall. MoviesMod, for example, routes every download through
`links.modpro.blog` → `cloud.unblockedgames.world`, which serves a "Please
verify that you are human" interstitial — unusable from a provider.

### Verified chains

Both end at the same two hosts, which our extractors already understand:

```
MoviesDrive  post page ──► mdrive.lol/archive/<id> ──► hubcloud.cx/drive/<id>  ──► signed R2 / 10Gbps / Pixeldrain
                                                  └──► gdflix.dev/file/<id>    ──► instant.busycdn / R2

HDHub4u      post page ──► hubdrive.tips/file/<id> ──► hubcloud.cx/drive/<id>  ──► (as above)
                       └──► hubcdn.sbs/file/<id>
```

`hubdrive.tips` is a landing page, not the file: it exposes a
`[HubCloud Server]` link to the real entry, so `hdhub4u/stream.ts` unwraps it
before handing off to the extractor.

### Endpoints

| Purpose | MoviesDrive | HDHub4u |
| --- | --- | --- |
| Listing | `/`, `/category/<slug>/page/N/` | `/`, `/category/<slug>/page/N/` |
| Search | `/search.php?q=&page=` (Typesense JSON) | `/?s=` and `/page/N/?s=` |
| Detail | `/<slug>/` | `/<slug>/` |
| Episodes | `mdrive.lol/archive/<id>` | in-page `EPiSODE N` headings |

MoviesDrive exposes a **Typesense-backed JSON search**, which is far more
reliable than scraping its results page; HDHub4u only has WordPress `?s=`.

### Domain rotation

Both sites rotate domains constantly and are DNS-blocked by Indian ISPs — which
surfaces as a network error with *no HTTP response*, so retrying the same host
never recovers. Each provider ships a mirror list and fails over automatically,
caching whichever mirror answered in `kvStore`. Users can pin a domain in
settings.

### HDHub4u gates its download links

The post page renders fine without them — title, poster, storyline,
screenshots — but the **DOWNLOAD LINKS block is withheld** unless the request
carries a visitor cookie and an external referer:

```
Cookie:  xla=s4t
Referer: https://google.com
```

Without those, `getMeta` parses a perfectly valid page, finds nothing playable,
and fails with *"no download links found"*. Both headers are now sent on every
request (the reference provider sends the same pair).

### HDHub4u: the site cookie must not reach the file hosts

`Cookie: xla=s4t` unlocks the download block **on hdhub4u only**. It must not
be forwarded to HubCloud/GDFlix, because the shared extractor injects its own
cookie bundle - including `cf_clearance` - *only when `Cookie` is unset*:

```js
if (!headers["Cookie"]) headers["Cookie"] = "...; xla=s4t; cf_clearance=...";
```

Passing the site cookie through therefore suppresses the clearance cookie, the
CDN answers with a challenge, and every host 403s — surfacing as *"every file
host for this title failed to resolve"*. `extractorHeaders()` builds a
cookie-free header set, fresh per host (the extractors mutate what they are
handed, so a shared object leaks state between attempts).

### HDHub4u link hosts

Three kinds of link appear in that block, and they need different handling:

| Link | Handling |
| --- | --- |
| `hubdrive.tips`, `hubcdn.sbs` | unwrapped to HubCloud, then the shared extractor |
| `greenmountmotors.com/?id=<base64>` | **redirector** — decode to the real file |
| `hdstream4u.com`, `hubstream.art` | browser-only players — excluded |

The redirector is a throwaway domain that rotates constantly, so it is matched
structurally (a lone `?id=`/`?r=` param holding base64) rather than by
hostname. The payload decodes to the destination, sometimes wrapped one more
level as `hubcdn.sbs/dl/?link=<real>`; both are unwrapped, yielding a direct
R2/CDN file. Dropping these links entirely — as an earlier version did — loses
the `720p x264` and `1080p x264` qualities on most movie pages.

### HDHub4u listing markup

The poster is **not inside the link**. One listing entry is three siblings:

```html
<img src="poster.jpg" alt="Title ...">   <!-- poster, beside the anchors -->
<a href="/slug/"></a>                    <!-- empty anchor, no text/img -->
<a href="/slug/">Title ...</a>           <!-- title anchor, no img -->
```

So `anchor.find("img")` finds nothing and every post gets dropped for having no
poster — which is the *"Provider returned no posts"* the app reports. `posts.ts`
groups anchors by permalink, then looks for the poster inside the anchor *and*
falls back to the nearest image in the surrounding `<li>`.

**HDHub4u mirrors need care.** Only the `newN.hdhub4u.<tld>` hosts serve the
catalogue. The heavily-advertised "official" domains the site banners at the
top of every page — `hdhub4u.bi`, `.ec`, `.ms`, `.tv`, `.download` — are static
SEO landing pages: they answer **HTTP 200 with real HTML and zero posts**.

Listing them as fallbacks is worse than having no fallback, because a plain
status check accepts one, caches it as "the working mirror", and every listing
is empty from then on. That is exactly the *"hdhub4u returns no posts"* failure.
`fetchPage` now requires a page to link at least one `/category/<slug>/` route
before accepting it, so a landing page is treated as a miss and failover keeps
looking. If nothing real is reachable the provider raises an error rather than
returning an empty list, so the app can say *"unavailable"* instead of quietly
showing nothing.

### Structural quirks handled

- **Post links are stored site-relative** (`/the-whisper-man-2026.../`) so a
  saved library entry keeps working after the domain rotates.
- **Zip / PACK links are excluded** from streaming results. These are multi-GB
  whole-season archives (`1080p WEB-DL PACK [27.2GB]`, `720p Zip [2.5GB]`) —
  a player cannot open them, so offering them as a "stream" is a dead end.
- **Screenshots are not posters.** Both pages embed 8+ `catimages.org` /
  `vlcsnap` stills; the poster picker skips those and the Telegram/WhatsApp
  banners.
- **Series layouts differ.** MoviesDrive groups by season and defers to
  `episodes.ts` (each season is its own archive page); HDHub4u lists every
  episode inline under `EPiSODE N` headings, so `meta.ts` groups them into one
  row per quality with the episodes as `directLinks`.
- **Synopsis terminator.** Both pages separate blocks with single newlines, so
  a blank-line-terminated regex silently matched nothing — the offline suite
  caught this and it is now anchored on the next block heading or EOL.

### Tests

```bash
npm run test:hindi        # offline: replays captured responses (99 assertions)
npm run test:hindi:live   # online: walks several real titles end to end
```

The offline suite exercises **both providers across four content shapes** —
a dual-audio movie (The Whisper Man), a Hindi-only movie (Awarapan 2 / Alpha),
a multi-season dual-audio series (Reacher S1–S4) and a Hindi web series
(Mousetrap S1) — because movies and series are laid out very differently on
these sites. The mock serves the same markup the real file hosts return, so the
**genuine hubcloud/gdflix extractor code runs** rather than being stubbed.

The live script takes an optional provider and title:

```bash
npm run test:hindi:live -- moviesDrive
npm run test:hindi:live -- hdhub4u "Alpha"
```

It probes each resolved link with a ranged GET and reports whether it served
real media, an HTML error page, or failed — then prints a pass/fail table per
title.

### Known limitations

These are download-index sites: links expire when the uploader rotates them,
and a title can be listed while its file host is already dead. Both providers
try every mirror on a page and raise a clear error rather than returning a link
that will not play. Playback quality depends entirely on the upload (HQ-HDTC
cam rips are labelled as such in the title, and are passed through unchanged).
