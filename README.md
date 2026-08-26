# providers

Vega App provider extensions, based on the
[vega-org/providers-template](https://github.com/vega-org/providers-template) layout.

## Providers

| Provider | Value | Site |
| --- | --- | --- |
| YoMovies | `yomovies` | https://yomovies.energy |
| ExtraMovies | `extraMovies` | https://extramovies.miami |

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
- `stream.ts` – delegates to the shared `extractors/hubcloud.ts` (vendored from
  Zenda-Cross/vega-providers), which already handles the
  hubcloud -> vcloud -> final-file redirect chain, WAF solving, Gofile and
  Pixeldrain. Exports `nonStreamableServer` so the app does not hand a
  download-only mirror to the video player, and orders playable servers first
  for streaming / download-optimised mirrors first for downloads.
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
