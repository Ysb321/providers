import { ProviderContext } from "../types";

export const PROVIDER_NAME = "moviesDrive";

/**
 * MoviesDrive rotates its domain constantly (the site itself banners
 * "MoviesDrives.mov / MovieDrive.org" as the canonical bookmarks while serving
 * from `newN.moviesdrive.<tld>`). The value below is what resolved when this
 * provider was written; users can point at a newer one from settings, and
 * `resolveBaseUrl` walks the known mirrors when the default is dead.
 */
export const DEFAULT_BASE_URL = "https://new3.moviesdrive.christmas";

/**
 * Sibling domains to try when the configured one is unreachable. Indian ISPs
 * DNS-block these individually, which surfaces as a network error with no HTTP
 * response at all, so a plain retry on the same host never recovers.
 */
export const MIRRORS = [
  "https://new3.moviesdrive.christmas",
  "https://new2.moviesdrive.christmas",
  "https://new1.moviesdrive.christmas",
  "https://moviesdrives.mov",
  "https://moviedrive.org",
  "https://moviesdrives.cfd",
];

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const pageHeaders: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": DESKTOP_UA,
};

/* ------------------------------------------------------------------ *
 * settings + base url                                                 *
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

function normalise(value: string): string {
  let url = value.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\/+$/, "");
}

/** Configured base url, honouring the user override. */
export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await readSetting<string>(
    providerContext,
    "moviesDriveBaseUrl",
  );
  if (override && override.trim()) return normalise(override);

  const cached = await readSetting<string>(providerContext, "moviesDriveMirror");
  if (cached && cached.trim()) return normalise(cached);

  return DEFAULT_BASE_URL;
}

/**
 * GETs a page, transparently failing over to sibling mirrors when the current
 * host is blocked or down. A working mirror is cached so later calls go
 * straight to it.
 */
export async function fetchPage({
  path,
  providerContext,
  signal,
  absoluteUrl,
}: {
  path?: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
  absoluteUrl?: string;
}): Promise<{ html: string; baseUrl: string }> {
  const { axios } = providerContext;

  // An absolute url bypasses mirror selection - it is already fully qualified.
  if (absoluteUrl) {
    const res = await axios.get(absoluteUrl, {
      headers: pageHeaders,
      signal,
      timeout: 20000,
      validateStatus: (status: number) => status < 500,
    });
    return {
      html: typeof res.data === "string" ? res.data : "",
      baseUrl: absoluteUrl.split("/").slice(0, 3).join("/"),
    };
  }

  const configured = await getBaseUrl(providerContext);
  const candidates = [configured, ...MIRRORS.filter((m) => m !== configured)];
  let lastError: unknown;

  for (const base of candidates) {
    try {
      const res = await axios.get(`${base}${path || "/"}`, {
        headers: pageHeaders,
        signal,
        timeout: 20000,
        validateStatus: (status: number) => status < 500,
      });
      const html = typeof res.data === "string" ? res.data : "";
      if (res.status >= 400 || !html) {
        lastError = new Error(`HTTP ${res.status} from ${base}${path || "/"}`);
        continue;
      }
      if (base !== configured) {
        try {
          await providerContext.kvStore.set("moviesDriveMirror", base);
        } catch {
          /* kvStore unavailable */
        }
      }
      return { html, baseUrl: base };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`could not reach MoviesDrive for ${path}`);
}

/** GETs the Typesense-backed search endpoint, with the same mirror failover. */
export async function fetchSearch({
  query,
  page,
  providerContext,
  signal,
}: {
  query: string;
  page: number;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<{ payload: any; baseUrl: string }> {
  const { axios } = providerContext;
  const configured = await getBaseUrl(providerContext);
  const candidates = [configured, ...MIRRORS.filter((m) => m !== configured)];
  let lastError: unknown;

  for (const base of candidates) {
    try {
      const res = await axios.get(
        `${base}/search.php?q=${encodeURIComponent(query)}&page=${page}`,
        {
          headers: { ...pageHeaders, Accept: "application/json, */*" },
          signal,
          timeout: 20000,
          validateStatus: (status: number) => status < 500,
        },
      );
      const payload =
        typeof res.data === "string" ? safeParse(res.data) : res.data;
      if (!payload) {
        lastError = new Error(`non-JSON search response from ${base}`);
        continue;
      }
      return { payload, baseUrl: base };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("could not reach MoviesDrive search");
}

function safeParse(value: string): any {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * url helpers                                                         *
 * ------------------------------------------------------------------ */

export function absolutise(href: string, baseUrl: string): string {
  if (!href) return "";
  const trimmed = href.replace(/&amp;/gi, "&").trim();
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return baseUrl.replace(/\/+$/, "") + trimmed;
  return `${baseUrl.replace(/\/+$/, "")}/${trimmed}`;
}

/**
 * Stores post links as a site-relative path so a cached library entry keeps
 * working after the domain rotates.
 */
export function toRelativePath(href: string, baseUrl: string): string {
  const absolute = absolutise(href, baseUrl);
  const withoutScheme = absolute.replace(/^https?:\/\/[^/]+/i, "");
  return withoutScheme || "/";
}

/* ------------------------------------------------------------------ *
 * parsing helpers                                                     *
 * ------------------------------------------------------------------ */

/** Strips the site's decoration so titles read like real film names. */
export function cleanTitle(raw: string): string {
  return (raw || "")
    .replace(/^\s*Download\s+/i, "")
    .replace(/\s*\|\s*Full Movie.*$/i, "")
    .replace(/\s*[-–]\s*MoviesDrive.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function qualityFromText(
  value: string,
): "360" | "480" | "720" | "1080" | "2160" | undefined {
  const text = (value || "").toLowerCase();
  if (/2160|4k|uhd/.test(text)) return "2160";
  if (/1080|fhd/.test(text)) return "1080";
  if (/720/.test(text)) return "720";
  if (/480/.test(text)) return "480";
  if (/360/.test(text)) return "360";
  return undefined;
}

/** True when a link points at a host one of our extractors understands. */
export function isFileHost(url: string): boolean {
  return /(hubcloud|hubdrive|hubcdn|vcloud|driveleech|driveseed|gdflix|gdlink|gofile\.io|pixeldrain|fastdl)/i.test(
    url,
  );
}

/**
 * Zip/pack links bundle a whole season into one archive - useless to a video
 * player, so they are filtered out of streaming results.
 */
export function isZipLink(text: string, url: string): boolean {
  return /\bzip\b|\bpack\b/i.test(text) || /\bzip\b/i.test(url);
}
