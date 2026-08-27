import { ProviderContext } from "../types";

export const PROVIDER_NAME = "net77";

/**
 * NetMirror rotates its browser domain every few weeks (net22 -> net11 ->
 * net27 -> net77 ...). The value below is the mirror this provider was built
 * against; users can point at a newer one from provider settings.
 */
export const DEFAULT_BASE_URL = "https://net77.cc";

/**
 * `net27.cc` exposes a second, TMDB-keyed REST API that returns progressive
 * MP4 files instead of the HLS masters the main site serves. It is used as a
 * fallback whenever the native flow only yields the guest placeholder.
 * Its CDN enforces an anti-hotlink check that only accepts this Referer.
 */
export const TMDB_API_BASE = "https://net27.cc";
export const TMDB_API_REFERER = "https://videodownloader.site/";

/** Public TMDB read key used purely to map a title/year onto a TMDB id. */
export const DEFAULT_TMDB_KEY = "439c478a771f35c05022f9feabcca01c";

/**
 * Guest HLS masters advertise their video renditions under this shared id.
 * It is a ~10 minute "please sign in" placeholder reel, NOT the real title -
 * detecting it is what stops the provider from handing the player a stream
 * that looks fine but plays the wrong thing.
 */
export const PLACEHOLDER_ID = "220884";

export type OttCode = "nf" | "pv";

export interface OttSection {
  code: OttCode;
  label: string;
  /** Path prefix for this catalogue ("" = Netflix, "/pv" = Prime Video). */
  prefix: string;
  poster: (id: string) => string;
  episodePoster: (id: string) => string;
  /** Candidate browse pages, tried in order (markup differs per mirror). */
  homePaths: string[];
}

export const SECTIONS: Record<OttCode, OttSection> = {
  nf: {
    code: "nf",
    label: "Netflix",
    prefix: "",
    poster: (id) => `https://imgcdn.kim/poster/v/${id}.jpg`,
    episodePoster: (id) => `https://imgcdn.kim/poster/v/150/${id}.jpg`,
    homePaths: ["/mobile/home?app=1", "/home", "/"],
  },
  pv: {
    code: "pv",
    label: "Prime Video",
    prefix: "/pv",
    poster: (id) => `https://imgcdn.kim/pv/341/${id}.jpg`,
    episodePoster: (id) => `https://imgcdn.kim/pvepimg/${id}.jpg`,
    homePaths: ["/pv/", "/mobile/pv/home?app=1", "/pv/home"],
  },
};

export function isOttCode(value: string): value is OttCode {
  return value === "nf" || value === "pv";
}

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Sent on document requests (browse pages). */
export const pageHeaders: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": DESKTOP_UA,
};

/** Sent on the *.php JSON endpoints, which are XHRs in the real site. */
export const ajaxHeaders: Record<string, string> = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": DESKTOP_UA,
};

/**
 * Headers the video player has to replay on the manifest AND on every
 * segment. The NetMirror CDNs (`*.nm-cdn*.top`, `*.freecdn*.top`) answer 404
 * to requests without a Referer, which is the classic "the link resolves but
 * nothing plays" failure. No `Origin` is sent on purpose: these hosts treat a
 * request carrying one as a browser XHR and apply a CORS allow-list.
 */
export function playbackHeaders(referer: string): Record<string, string> {
  return {
    Referer: referer.replace(/\/+$/, "") + "/",
    "User-Agent": DESKTOP_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: "hd=on",
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

export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await readSetting<string>(providerContext, "net77BaseUrl");
  if (override && override.trim()) {
    let url = override.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    return url.replace(/\/+$/, "");
  }
  return DEFAULT_BASE_URL;
}

export async function isFallbackEnabled(
  providerContext: ProviderContext,
): Promise<boolean> {
  const value = await readSetting<boolean>(providerContext, "net77UseFallback");
  return value !== false;
}

export async function getTmdbKey(
  providerContext: ProviderContext,
): Promise<string> {
  const key = await readSetting<string>(providerContext, "net77TmdbKey");
  return key && key.trim() ? key.trim() : DEFAULT_TMDB_KEY;
}

/* ------------------------------------------------------------------ *
 * guest session                                                       *
 * ------------------------------------------------------------------ */

const COOKIE_KEY = "net77GuestCookie";
const COOKIE_TS_KEY = "net77GuestCookieTs";
const COOKIE_TTL_MS = 12 * 60 * 60 * 1000;

function readSetCookie(res: any, name: string): string {
  const raw =
    res?.headers?.["set-cookie"] ||
    res?.headers?.["Set-Cookie"] ||
    res?.headers?.get?.("set-cookie");
  const list: string[] = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const entry of list) {
    const match = new RegExp(`${name}=([^;]+)`).exec(entry);
    if (match) return decodeURIComponent(match[1]);
  }
  return "";
}

/**
 * The site hands anonymous visitors a `t_hash_t` session cookie from
 * `verify.php`. The captcha answer is never validated server-side, so posting
 * an arbitrary token is enough - this is the same handshake the official app
 * performs on first launch. Without it `post.php` replies `Invalid User`.
 */
export async function getGuestCookie({
  providerContext,
  baseUrl,
  force,
  signal,
}: {
  providerContext: ProviderContext;
  baseUrl: string;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  if (!force) {
    const [cached, ts] = await Promise.all([
      readSetting<string>(providerContext, COOKIE_KEY),
      readSetting<number>(providerContext, COOKIE_TS_KEY),
    ]);
    if (cached && ts && Date.now() - ts < COOKIE_TTL_MS) return cached;
  }

  const { axios, openWebView } = providerContext;
  let token = "";

  try {
    const res = await axios.post(
      `${baseUrl}/verify.php`,
      `g-recaptcha-response=${Date.now().toString(16)}${Math.random()
        .toString(16)
        .slice(2)}`,
      {
        headers: {
          ...ajaxHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: baseUrl,
          Referer: `${baseUrl}/verify2`,
        },
        signal,
        maxRedirects: 0,
        validateStatus: (status: number) => status < 400 || status === 302,
      },
    );
    token = readSetCookie(res, "t_hash_t");
  } catch (err) {
    console.log("net77: verify.php handshake failed:", err);
  }

  // Cloudflare sometimes fronts verify.php - let the app solve it visually.
  if (!token && typeof openWebView === "function") {
    try {
      const result = await openWebView(`${baseUrl}/verify2`, {
        title: "Verifying with NetMirror",
        description: "Complete the check once to start streaming.",
        waitForCookie: "t_hash_t",
        timeoutMs: 60000,
      });
      token = result?.cookieMap?.t_hash_t || "";
      if (!token && result?.cookies) {
        token = (/t_hash_t=([^;]+)/.exec(result.cookies) || [])[1] || "";
      }
    } catch (err) {
      console.log("net77: WebView verification failed:", err);
    }
  }

  if (token) {
    try {
      await providerContext.kvStore.set(COOKIE_KEY, token);
      await providerContext.kvStore.set(COOKIE_TS_KEY, Date.now());
    } catch {
      /* kvStore unavailable */
    }
  }
  return token;
}

export function cookieHeader(token: string, ott: OttCode): string {
  const parts = [`ott=${ott}`, "hd=on"];
  if (token) parts.unshift(`t_hash_t=${token}`);
  return parts.join("; ");
}

/* ------------------------------------------------------------------ *
 * request helpers                                                     *
 * ------------------------------------------------------------------ */

export function nowSeconds(): number {
  return Math.round(Date.now() / 1000);
}

function parseMaybeJson(data: unknown): any {
  if (typeof data !== "string") return data;
  const trimmed = data.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isInvalidUser(payload: any): boolean {
  return (
    payload &&
    typeof payload === "object" &&
    payload.status === "n" &&
    /invalid user/i.test(String(payload.error || ""))
  );
}

/**
 * GETs one of the site's `*.php` JSON endpoints. Transparently (re)negotiates
 * the guest session when the backend rejects the current one.
 */
export async function fetchApi<T = any>({
  path,
  ott,
  providerContext,
  signal,
}: {
  path: string;
  ott: OttCode;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<T> {
  const { axios } = providerContext;
  const baseUrl = await getBaseUrl(providerContext);
  const url = `${baseUrl}${path}`;

  const request = async (token: string) => {
    const res = await axios.get(url, {
      headers: {
        ...ajaxHeaders,
        Referer: `${baseUrl}/`,
        Cookie: cookieHeader(token, ott),
      },
      signal,
      validateStatus: (status: number) => status < 500,
    });
    return parseMaybeJson(res.data);
  };

  let token = await getGuestCookie({ providerContext, baseUrl, signal });
  let payload = await request(token);

  if (isInvalidUser(payload) || payload === null) {
    token = await getGuestCookie({
      providerContext,
      baseUrl,
      force: true,
      signal,
    });
    payload = await request(token);
  }

  if (payload === null) {
    throw new Error(`non-JSON response from ${url}`);
  }
  if (isInvalidUser(payload)) {
    throw new Error(
      `${url} rejected the guest session - open the provider once in the app to refresh it`,
    );
  }
  return payload as T;
}

export async function fetchPage({
  path,
  ott,
  providerContext,
  signal,
}: {
  path: string;
  ott: OttCode;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<string> {
  const { axios } = providerContext;
  const baseUrl = await getBaseUrl(providerContext);
  const token = await getGuestCookie({ providerContext, baseUrl, signal });

  const res = await axios.get(`${baseUrl}${path}`, {
    headers: {
      ...pageHeaders,
      Referer: `${baseUrl}/`,
      Cookie: cookieHeader(token, ott),
    },
    signal,
    validateStatus: (status: number) => status < 500,
  });
  return typeof res.data === "string" ? res.data : "";
}

/* ------------------------------------------------------------------ *
 * NewTV (official app) endpoint discovery                             *
 * ------------------------------------------------------------------ */

/**
 * The Android app never talks to the browser domain for playback. It asks a
 * rotating pool of "mobiledetect" hosts for the current media API base, which
 * comes back base64 encoded. That API is not behind Cloudflare and returns a
 * master playlist for a bare content id.
 */
const NEW_TV_DOMAINS = [
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
];

export const newTvHeaders: Record<string, string> = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Requested-With": "NetmirrorNewTV v1.0",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
  Accept: "application/json, text/plain, */*",
};

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Minimal base64 decoder. The provider sandbox does not guarantee the usual
 * platform decoders, so this is implemented from the alphabet directly.
 */
export function decodeBase64(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_ALPHABET.indexOf(clean[i]);
    const c1 = B64_ALPHABET.indexOf(clean[i + 1]);
    const c2 = B64_ALPHABET.indexOf(clean[i + 2]);
    const c3 = B64_ALPHABET.indexOf(clean[i + 3]);
    if (c0 < 0 || c1 < 0) break;
    out += String.fromCharCode((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) out += String.fromCharCode(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 >= 0) out += String.fromCharCode(((c2 & 3) << 6) | c3);
  }
  return out;
}

const NEW_TV_KEY = "net77NewTvBase";
const NEW_TV_TS_KEY = "net77NewTvBaseTs";
const NEW_TV_TTL_MS = 24 * 60 * 60 * 1000;

export async function resolveNewTvBase({
  providerContext,
  signal,
}: {
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<string> {
  const [cached, ts] = await Promise.all([
    readSetting<string>(providerContext, NEW_TV_KEY),
    readSetting<number>(providerContext, NEW_TV_TS_KEY),
  ]);
  if (cached && ts && Date.now() - ts < NEW_TV_TTL_MS) return cached;

  const { axios } = providerContext;
  for (const encoded of NEW_TV_DOMAINS) {
    const host = decodeBase64(encoded).replace(/\/+$/, "");
    if (!host) continue;
    try {
      const res = await axios.get(`${host}/checknewtv.php`, {
        headers: newTvHeaders,
        signal,
        timeout: 10000,
      });
      const payload = parseMaybeJson(res.data);
      const hash = payload?.token_hash;
      if (typeof hash === "string" && hash) {
        const base = decodeBase64(hash).replace(/\/+$/, "");
        if (/^https?:\/\//i.test(base)) {
          try {
            await providerContext.kvStore.set(NEW_TV_KEY, base);
            await providerContext.kvStore.set(NEW_TV_TS_KEY, Date.now());
          } catch {
            /* ignore */
          }
          return base;
        }
      }
    } catch {
      // try the next domain in the pool
    }
  }
  return "";
}

/* ------------------------------------------------------------------ *
 * TMDB resolution                                                     *
 * ------------------------------------------------------------------ */

export interface TmdbIds {
  tmdbId: string;
  imdbId: string;
}

/**
 * Maps a NetMirror title onto TMDB/IMDb ids.
 *
 * `tmdbId` is what the net27 MP4 API keys on; `imdbId` lets the Vega app pull
 * richer artwork and metadata from Cinemeta. Both come from one lookup and are
 * cached per title so browsing then playing does not repeat the work.
 */
export async function resolveTmdbIds({
  title,
  year,
  isSeries,
  providerContext,
  signal,
}: {
  title: string;
  year?: string;
  isSeries: boolean;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<TmdbIds> {
  const empty: TmdbIds = { tmdbId: "", imdbId: "" };
  const clean = (title || "").trim();
  if (!clean) return empty;

  const cacheKey = `net77Tmdb:${isSeries ? "tv" : "movie"}:${clean}:${year || ""}`;
  const cached = await readSetting<TmdbIds>(providerContext, cacheKey);
  if (cached && typeof cached === "object") return cached;

  const { axios } = providerContext;
  const apiKey = await getTmdbKey(providerContext);
  const mediaType = isSeries ? "tv" : "movie";

  try {
    const searchRes = await axios.get(
      `https://api.themoviedb.org/3/search/${mediaType}` +
        `?api_key=${apiKey}&query=${encodeURIComponent(clean)}`,
      { headers: { Accept: "application/json" }, signal, timeout: 12000 },
    );
    const payload =
      typeof searchRes.data === "string"
        ? JSON.parse(searchRes.data)
        : searchRes.data;
    const results: any[] = payload?.results || [];
    if (!results.length) return empty;

    // Titles get remade, so prefer an exact year match when we know the year.
    let match = results[0];
    if (year) {
      const exact = results.find((r) => {
        const date = isSeries ? r?.first_air_date : r?.release_date;
        return typeof date === "string" && date.slice(0, 4) === year;
      });
      if (exact) match = exact;
    }
    if (!match?.id) return empty;

    const ids: TmdbIds = { tmdbId: String(match.id), imdbId: "" };

    try {
      const extRes = await axios.get(
        `https://api.themoviedb.org/3/${mediaType}/${ids.tmdbId}/external_ids` +
          `?api_key=${apiKey}`,
        { headers: { Accept: "application/json" }, signal, timeout: 12000 },
      );
      const ext =
        typeof extRes.data === "string" ? JSON.parse(extRes.data) : extRes.data;
      if (typeof ext?.imdb_id === "string") ids.imdbId = ext.imdb_id;
    } catch {
      // imdbId is a nice-to-have - the tmdbId alone still unlocks playback.
    }

    try {
      await providerContext.kvStore.set(cacheKey, ids);
    } catch {
      /* kvStore unavailable */
    }
    return ids;
  } catch (err) {
    console.log("net77: TMDB lookup failed:", err);
    return empty;
  }
}

/* ------------------------------------------------------------------ *
 * link tokens                                                         *
 * ------------------------------------------------------------------ */

/**
 * Everything the later stages need is packed into the `link` strings Vega
 * passes around, so no state has to survive between calls.
 */
export interface Playback {
  ott: OttCode;
  id: string;
  type?: "movie" | "series";
  title?: string;
  year?: string;
  season?: number;
  episode?: number;
  /** Parent series id - needed by `episodes.php`. */
  seriesId?: string;
}

export function encodeToken(value: Playback): string {
  return JSON.stringify(value);
}

export function decodeToken(link: string): Playback {
  try {
    const parsed = JSON.parse(link);
    if (parsed && typeof parsed === "object" && parsed.id) {
      const ott = isOttCode(parsed.ott) ? parsed.ott : "nf";
      return { ...parsed, ott } as Playback;
    }
  } catch {
    /* not a token - fall through */
  }
  // Tolerate "nf:<id>" and bare ids so hand-made links still resolve.
  const match = /^(nf|pv)[:|]([^:|]+)$/.exec(link.trim());
  if (match) return { ott: match[1] as OttCode, id: match[2] };
  return { ott: "nf", id: link.trim() };
}

export function absoluteUrl(href: string, baseUrl: string): string {
  if (!href) return "";
  const trimmed = href.replace(/&amp;/gi, "&").trim();
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return baseUrl.replace(/\/+$/, "") + trimmed;
  return `${baseUrl.replace(/\/+$/, "")}/${trimmed}`;
}

export function qualityFromLabel(
  label: string,
): "360" | "480" | "720" | "1080" | "2160" | undefined {
  const text = (label || "").toLowerCase();
  if (/2160|4k|uhd/.test(text)) return "2160";
  if (/1080|full\s*hd/.test(text)) return "1080";
  if (/720|mid\s*hd/.test(text)) return "720";
  if (/480|low\s*hd/.test(text)) return "480";
  if (/360/.test(text)) return "360";
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
