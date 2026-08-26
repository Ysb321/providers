# providers

Vega App provider extensions, based on the
[vega-org/providers-template](https://github.com/vega-org/providers-template) layout.

## Providers

| Provider | Value | Site |
| --- | --- | --- |
| YoMovies | `yomovies` | https://yomovies.energy |

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
