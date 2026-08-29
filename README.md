# Vega App Provider Extensions

This repository contains provider extensions for the **Vega App**, following the
same conventions as [`Zenda-Cross/vega-providers`](https://github.com/Zenda-Cross/vega-providers).

## Provider Folder Structure

Each provider lives in its own folder under `providers/`:

```
providers/
  myProvider/
    catalog.ts
    meta.ts
    posts.ts
    stream.ts
    episodes.ts (optional)
    settings.ts (optional)
```

Shared helpers (imported via `../`):

- `types.ts` – shared interfaces (`Post`, `Info`, `Stream`, `EpisodeLink`, `ProviderContext`, …)
- `getBaseUrl.ts` – resolves a provider's live base URL from `urls.json` (cached)
- `providerContext.ts` – `axios`, `cheerio`, `commonHeaders`, `kvStore`, `openWebView`
- `providerErrors.ts` – `throwProviderError` helper
- `getCinemetaMeta.ts` – Cinemeta metadata enrichment helper
- `theintrodb.ts` – skip timings (intro/recap/credits) enrichment
- `headers.ts` – default browser-like request headers

## Project Files

| File            | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| `manifest.json` | Registers providers with the app (`display_name`, `value`, …) |
| `urls.json`     | Maps provider keys to live base URLs                         |
| `package.json`  | Build / dev scripts, dependencies                           |
| `build-bundled.js` | Bundles each provider module into `dist/`                   |
| `dev-server.js`    | Local dev server serving `manifest.json` and `dist/`        |
| `tsconfig.json`    | TypeScript config                                           |

## Providers Included

### `dooflix`
A ported, working provider (API-based) that demonstrates the full
`catalog` / `posts` / `meta` / `stream` flow.

### `roshy`
A new WordPress-based **movies / TV series** provider **template** following the
conventions, with pagination, search (`?s=`), metadata, episode grouping and
stream extraction. It is registered in `manifest.json` (`hasSettings: true`)
and `urls.json`.

> **Note:** the `roshy` provider is a template that parses the standard
> WordPress movie/TV theme markup (`.movie-card`, `.film-item`,
> `article.post-item`, `h1.page-title`, etc.). Its base URL is intentionally
> left **empty** — set `providers/roshy/posts.ts`/`meta.ts` `defaultBaseUrl`
> or the `urls.json` entry to your intended **non‑adult** site, and adjust the
> selectors if the site differs. It is **not** wired to `roshy.tv`, which
> currently serves adult content.

## Building

```bash
npm install
npm run build        # bundles providers into dist/
```

## Running the local dev server

```bash
npm run dev
# serves /manifest.json and /dist/<provider>/<module>.js on http://localhost:3001
```

## Adding a New Provider

1. Create `providers/<name>/` with `catalog.ts`, `posts.ts`, `meta.ts`, `stream.ts`.
2. Optionally add `episodes.ts` and `settings.ts`.
3. Register it in `manifest.json`.
4. Add its base URL to `urls.json`.
5. `npm run build` and test via `npm run dev`.
