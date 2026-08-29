import { ProviderContext } from "../types";

export const PROVIDER_NAME = "hdhub4u";

/**
 * HDHub4u rotates its domain frequently (the site banners "HDHub4u.Tv |
 * HDHub4u.Bi" as canonical while serving from `newN.hdhub4u.<tld>`). The value
 * below resolved when this provider was written; `MIRRORS` is walked when it
 * is unreachable, and users can override it from settings.
 */
export const DEFAULT_BASE_URL = "https://new5.hdhub4u.cl";

/**
 * Content mirrors, in preference order.
 *
 * IMPORTANT: only the `newN.hdhub4u.<tld>` hosts serve the actual catalogue.
 * The heavily-advertised "official" domains (hdhub4u.bi / .ec / .ms / .tv /
 * .download) are static SEO landing pages - they answer HTTP 200 with a wall
 * of marketing copy and **zero posts**. Listing them as fallbacks is worse
 * than having no fallback at all: the failover would treat one as a success,
 * cache it, and the provider would then return an empty catalogue forever.
 * They are deliberately excluded; `looksLikeCatalogue` below is the backstop.
 */
export const MIRRORS = [
  "https://new5.hdhub4u.cl",
  "https://new4.hdhub4u.cl",
  "https://new3.hdhub4u.cl",
  "https://new2.hdhub4u.cl",
];

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * HDHub4u gates the download-link block behind a visitor cookie and an
 * external referer. Without `xla=s4t` the post page still renders - title,
 * poster, storyline, screenshots all present - but the "DOWNLOAD LINKS"
 * section is withheld, so getMeta finds nothing to play and fails with
 * "no download links found". The reference provider sends the same pair.
 */
export const pageHeaders: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  Cookie: "xla=s4t",
  Referer: "https://google.com",
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

export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await readSetting<string>(providerContext, "hdhub4uBaseUrl");
  if (override && override.trim()) return normalise(override);

  const cached = await readSetting<string>(providerContext, "hdhub4uMirror");
  if (cached && cached.trim()) return normalise(cached);

  return DEFAULT_BASE_URL;
}

/**
 * True when a response actually looks like the catalogue rather than one of
 * the SEO landing pages that share the brand.
 *
 * Those pages return HTTP 200 with real HTML, so a status check alone happily
 * accepts them - and then every listing comes back empty. A genuine page
 * always links to at least one `/category/<slug>/` route.
 */
function looksLikeCatalogue(html: string): boolean {
  if (!html || html.length < 500) return false;
  return /href=["'][^"']*\/category\/[^"']+["']/i.test(html);
}

/**
 * GETs a page, failing over to sibling mirrors when the current host is
 * DNS-blocked or down (common for these domains on Indian ISPs, where the
 * failure is a network error with no HTTP response). The working mirror is
 * cached for later calls.
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
      // A landing page answers 200 with no catalogue on it. Treat that as a
      // miss so failover keeps looking instead of caching a dead-end host.
      if (!looksLikeCatalogue(html)) {
        lastError = new Error(
          `${base} responded but served no catalogue (looks like a landing page)`,
        );
        continue;
      }
      if (base !== configured) {
        try {
          await providerContext.kvStore.set("hdhub4uMirror", base);
        } catch {
          /* kvStore unavailable */
        }
      }
      return { html, baseUrl: base };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`could not reach HDHub4u for ${path}`);
}

/* ------------------------------------------------------------------ *
 * url + parsing helpers                                               *
 * ------------------------------------------------------------------ */

export function absolutise(href: string, baseUrl: string): string {
  if (!href) return "";
  const trimmed = href.replace(/&amp;/gi, "&").trim();
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return baseUrl.replace(/\/+$/, "") + trimmed;
  return `${baseUrl.replace(/\/+$/, "")}/${trimmed}`;
}

/** Post links are stored relative so entries survive a domain rotation. */
export function toRelativePath(href: string, baseUrl: string): string {
  const absolute = absolutise(href, baseUrl);
  const withoutScheme = absolute.replace(/^https?:\/\/[^/]+/i, "");
  return withoutScheme || "/";
}

export function cleanTitle(raw: string): string {
  return (raw || "")
    .replace(/^\s*Download\s+/i, "")
    .replace(/\s*\|\s*(Full Movie|Full Series).*$/i, "")
    .replace(/\s*[-–]\s*HDHub4u.*$/i, "")
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

/**
 * Hosts our extractors understand.
 *
 * `hubdrive`/`hubcdn` are HubCloud-family front-ends: a hubdrive page exposes
 * a `[HubCloud Server]` link to the real file (verified live).
 */
export function isFileHost(url: string): boolean {
  return (
    /(hubcloud|hubdrive|hubcdn|vcloud|driveleech|driveseed|gdflix|gdlink|gofile\.io|pixeldrain)/i.test(
      url,
    ) || isRedirector(url)
  );
}

/**
 * Some qualities are published behind a throwaway redirector domain
 * (`greenmountmotors.com/?id=<base64>`, `inventoryidea.com/?r=<base64>`)
 * rather than a named file host. They still lead to a real file - the payload
 * decodes to a hubcdn/R2 url - so they must not be filtered out, or the only
 * links left on some pages are the ones we reject and the title looks empty.
 *
 * Matched structurally (single `id`/`r` query param holding base64) rather
 * than by hostname, because the domain is rotated constantly.
 */
export function isRedirector(url: string): boolean {
  return /^https?:\/\/[^/]+\/\?(?:id|r)=[A-Za-z0-9+/=_-]{16,}$/i.test(url);
}

/**
 * Playback-only players. They stream in a browser but expose no file we can
 * hand to the app's video pipeline, so they are not offered as sources.
 */
export function isPlayerOnly(url: string): boolean {
  return /(hdstream4u|hubstream)\./i.test(url);
}

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Minimal base64 decoder. The provider sandbox does not guarantee the usual
 * platform decoders, so this is implemented from the alphabet directly.
 */
export function decodeBase64(input: string): string {
  const clean = (input || "").replace(/[^A-Za-z0-9+/=]/g, "");
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

/**
 * Season/episode "PACK" links are multi-GB archives of a whole season - not
 * something a player can open, so they are excluded from streaming results.
 */
export function isPackLink(text: string, url: string): boolean {
  return /\bpack\b|\bzip\b/i.test(text) || /\/packs?\//i.test(url);
}
