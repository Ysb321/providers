import { ProviderContext } from "../types";

export const PROVIDER_NAME = "redflix";
export const DEFAULT_BASE_URL = "https://redflix.club";

/**
 * redflix.club is a Next.js front-end that is keyed entirely on TMDB ids:
 * every catalogue tile links to `/play?id=<tmdbId>&type=movie|tv`, and the
 * playback page delegates to third-party embed providers (VidFast, Videasy,
 * VidLink, ...) rather than hosting media itself.
 *
 * Consequences for this provider:
 *  - Catalogue/metadata come from the keyless TMDB mirror below, which is what
 *    the embed backend itself uses. The site's own grids are infinite-scroll
 *    (`/movies?page=2` returns page 1 again - verified), so the mirror is the
 *    only way to page reliably.
 *  - Search uses the site's own `/browse?q=` page, because Redflix filters its
 *    catalogue and returns fewer hits than a raw TMDB query.
 *  - Streams are resolved from the embed providers (see stream.ts).
 */
export const TMDB_MIRROR = "https://db.speedracelight.com/3";

/** Videasy media backend (seed + per-server encrypted source lists). */
export const VIDEASY_API = "https://api.speedracelight.com";
export const VIDEASY_ORIGIN = "https://player.videasy.to";

/** VidFast player origin. `vidfast.pro` 302s here - verified. */
export const VIDFAST_ORIGIN = "https://vidfast.vc";

/**
 * Public encrypt/decrypt helper for the embed providers' payloads.
 *
 * Both VidFast and Videasy return AES/WASM-encrypted blobs. Doing that crypto
 * inside the provider sandbox is not possible (no `crypto`, no WASM), so the
 * same service the upstream `autoEmbed` provider relies on is used here.
 * It is overridable in settings for anyone self-hosting `EncDecEndpoints`.
 */
export const DEFAULT_ENC_DEC_API = "https://enc-dec.app/api";

export const IMAGE_BASE = "https://image.tmdb.org/t/p";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

/** Sent when scraping redflix.club's own server-rendered pages. */
export const pageHeaders: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": DESKTOP_UA,
};

/** Sent to the TMDB mirror - it needs no API key, but does want a browser UA. */
export const apiHeaders: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": DESKTOP_UA,
};

/** Videasy's backend validates the player origin on every call. */
export const videasyHeaders: Record<string, string> = {
  Accept: "*/*",
  Origin: VIDEASY_ORIGIN,
  Referer: VIDEASY_ORIGIN + "/",
  "User-Agent": DESKTOP_UA,
};

/** VidFast's server/stream POSTs are XHRs guarded by a CSRF token. */
export function vidfastHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": DESKTOP_UA,
    Referer: VIDFAST_ORIGIN + "/",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (token) headers["X-CSRF-Token"] = token;
  return headers;
}

/**
 * Headers the video player must replay on the manifest AND on every segment.
 *
 * Deliberately no `Origin`: these CDNs treat a request carrying one as a
 * browser XHR and apply a CORS allow-list, answering 403 to the player's
 * segment requests while a plain one-shot download still succeeds. That
 * asymmetry is the classic "download works, streaming doesn't" failure.
 */
export function playbackHeaders(referer: string): Record<string, string> {
  return {
    Referer: referer.replace(/\/+$/, "") + "/",
    "User-Agent": DESKTOP_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/* ------------------------------------------------------------------ *
 * settings                                                            *
 * ------------------------------------------------------------------ */

async function readSetting<T>(
  providerContext: ProviderContext,
  key: string,
): Promise<T | undefined> {
  try {
    return await providerContext.kvStore.get<T>(key);
  } catch {
    return undefined;
  }
}

function normaliseUrl(value: string): string {
  let url = value.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\/+$/, "");
}

export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await readSetting<string>(providerContext, "redflixBaseUrl");
  if (override && override.trim()) return normaliseUrl(override);
  return DEFAULT_BASE_URL;
}

export async function getEncDecApi(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await readSetting<string>(
    providerContext,
    "redflixEncDecApi",
  );
  if (override && override.trim()) return normaliseUrl(override);
  return DEFAULT_ENC_DEC_API;
}

export async function isSourceEnabled(
  providerContext: ProviderContext,
  key: "redflixUseVideasy" | "redflixUseVidfast",
): Promise<boolean> {
  const value = await readSetting<boolean>(providerContext, key);
  return value !== false;
}

/** Verifying every manifest costs a request each; allow opting out. */
export async function isVerifyEnabled(
  providerContext: ProviderContext,
): Promise<boolean> {
  const value = await readSetting<boolean>(
    providerContext,
    "redflixVerifyStreams",
  );
  return value !== false;
}

/* ------------------------------------------------------------------ *
 * HTTP helpers                                                        *
 * ------------------------------------------------------------------ */

export function parseMaybeJson(data: unknown): any {
  if (data === null || data === undefined) return null;
  if (typeof data !== "string") return data;
  const trimmed = data.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** GETs a path on the keyless TMDB mirror and returns parsed JSON. */
export async function getTmdb<T = any>({
  path,
  providerContext,
  signal,
}: {
  path: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<T> {
  const { axios } = providerContext;
  const url = `${TMDB_MIRROR}${path}`;
  const res = await axios.get(url, {
    headers: apiHeaders,
    signal,
    timeout: 15000,
  });
  const payload = parseMaybeJson(res.data);
  if (!payload) throw new Error(`unexpected response from ${url}`);
  return payload as T;
}

/** Fetches one of redflix.club's server-rendered pages. */
export async function getPage({
  path,
  providerContext,
  signal,
}: {
  path: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<string> {
  const { axios } = providerContext;
  const baseUrl = await getBaseUrl(providerContext);
  const res = await axios.get(`${baseUrl}${path}`, {
    headers: { ...pageHeaders, Referer: baseUrl + "/" },
    signal,
    timeout: 15000,
    validateStatus: (status: number) => status < 500,
  });
  return typeof res.data === "string" ? res.data : "";
}

/* ------------------------------------------------------------------ *
 * TMDB helpers                                                        *
 * ------------------------------------------------------------------ */

export function posterUrl(path?: string | null, size = "w500"): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${IMAGE_BASE}/${size}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function yearOf(item: any): string {
  const date = item?.release_date || item?.first_air_date || "";
  return typeof date === "string" ? date.slice(0, 4) : "";
}

export function titleOf(item: any): string {
  return item?.title || item?.name || item?.original_title || item?.original_name || "";
}

/* ------------------------------------------------------------------ *
 * link tokens                                                         *
 * ------------------------------------------------------------------ */

/**
 * Everything the later stages need is packed into the `link` strings the app
 * passes around, so no state has to survive between calls.
 */
export interface Playback {
  tmdbId: string;
  type: "movie" | "tv";
  title?: string;
  year?: string;
  imdbId?: string;
  season?: number;
  episode?: number;
}

export function encodeToken(value: Playback): string {
  return JSON.stringify(value);
}

export function decodeToken(link: string): Playback {
  try {
    const parsed = JSON.parse(link);
    if (parsed && typeof parsed === "object" && parsed.tmdbId) {
      return {
        ...parsed,
        tmdbId: String(parsed.tmdbId),
        type: parsed.type === "tv" ? "tv" : "movie",
      } as Playback;
    }
  } catch {
    /* not a token - fall through */
  }

  // Tolerate the site's own URLs and bare "tv:1396:3:7" / "1396" forms.
  const fromUrl = /[?&]id=(\d+)/.exec(link);
  if (fromUrl) {
    const isTv = /[?&]type=tv/.test(link);
    const season = Number((/[?&]season=(\d+)/.exec(link) || [])[1] || 0);
    const episode = Number((/[?&]episode=(\d+)/.exec(link) || [])[1] || 0);
    return {
      tmdbId: fromUrl[1],
      type: isTv ? "tv" : "movie",
      season: season || undefined,
      episode: episode || undefined,
    };
  }

  const parts = link.trim().split(/[:|]/);
  if (parts.length >= 2 && (parts[0] === "tv" || parts[0] === "movie")) {
    return {
      tmdbId: parts[1],
      type: parts[0] === "tv" ? "tv" : "movie",
      season: Number(parts[2]) || undefined,
      episode: Number(parts[3]) || undefined,
    };
  }

  return { tmdbId: link.trim(), type: "movie" };
}

/* ------------------------------------------------------------------ *
 * misc                                                                *
 * ------------------------------------------------------------------ */

export function qualityFromText(
  value: string | number | undefined,
): "360" | "480" | "720" | "1080" | "2160" | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).toLowerCase();
  if (/2160|4k|uhd/.test(text)) return "2160";
  if (/1440/.test(text)) return "1080";
  if (/1080|fhd|full\s*hd/.test(text)) return "1080";
  if (/720|hd/.test(text)) return "720";
  if (/480/.test(text)) return "480";
  if (/360|240/.test(text)) return "360";
  return undefined;
}

export function qualityFromHeight(
  height: number,
): "360" | "480" | "720" | "1080" | "2160" | undefined {
  if (!height) return undefined;
  if (height >= 1800) return "2160";
  if (height >= 900) return "1080";
  if (height >= 650) return "720";
  if (height >= 400) return "480";
  return "360";
}

/**
 * Videasy's backend expects the title double URL-encoded
 * ("Game of Thrones" -> "Game%2520of%2520Thrones").
 */
export function doubleEncode(value: string): string {
  const once = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return encodeURIComponent(once);
}
