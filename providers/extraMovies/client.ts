import { ProviderContext } from "../types";

export const PROVIDER_NAME = "extraMovies";
export const DEFAULT_BASE_URL = "https://extramovies.miami";

const COOKIE_KEY = "extraMoviesCfCookie";
const UA_KEY = "extraMoviesCfUserAgent";

export const emHeaders: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-ch-ua":
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/** Base url, honouring the mirror override stored in provider settings. */
export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  try {
    const override =
      await providerContext.kvStore.get<string>("extraMoviesBaseUrl");
    if (override && override.trim()) {
      let url = override.trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      return url.replace(/\/+$/, "");
    }
  } catch {
    /* kvStore unavailable */
  }
  return DEFAULT_BASE_URL;
}

async function getStored(
  providerContext: ProviderContext,
): Promise<{ cookie?: string; userAgent?: string }> {
  try {
    const [cookie, userAgent] = await Promise.all([
      providerContext.kvStore.get<string>(COOKIE_KEY),
      providerContext.kvStore.get<string>(UA_KEY),
    ]);
    return { cookie, userAgent };
  } catch {
    return {};
  }
}

async function store(
  providerContext: ProviderContext,
  cookie: string,
  userAgent: string,
): Promise<void> {
  try {
    if (cookie) await providerContext.kvStore.set(COOKIE_KEY, cookie);
    if (userAgent) await providerContext.kvStore.set(UA_KEY, userAgent);
  } catch {
    /* ignore */
  }
}

function isChallenge(body: unknown): boolean {
  if (typeof body !== "string") return false;
  return (
    /_cf_chl_opt|cdn-cgi\/challenge-platform|Just a moment/i.test(body) &&
    !/gridshow|post-title|entry-title|hubcloud/i.test(body)
  );
}

/**
 * GET a page from the site, transparently solving a Cloudflare challenge via
 * the app WebView when one is served, and caching the clearance cookie.
 */
export async function fetchPage({
  url,
  providerContext,
  signal,
  referer,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
  referer?: string;
}): Promise<string> {
  const { axios, openWebView } = providerContext;
  const origin = url.split("/").slice(0, 3).join("/");
  const stored = await getStored(providerContext);

  const buildHeaders = () => {
    const h: Record<string, string> = {
      ...emHeaders,
      Referer: referer || origin + "/",
    };
    if (stored.cookie) h.Cookie = stored.cookie;
    if (stored.userAgent) h["User-Agent"] = stored.userAgent;
    return h;
  };

  try {
    const res = await axios.get(url, {
      headers: buildHeaders(),
      signal,
      validateStatus: (status: number) => status < 500,
    });
    if (res.status < 400 && !isChallenge(res.data)) {
      return typeof res.data === "string" ? res.data : "";
    }
  } catch {
    /* fall through to solver */
  }

  if (typeof openWebView === "function") {
    try {
      const result = await openWebView(url, {
        title: "Verifying with ExtraMovies",
        description:
          "Cloudflare protection detected. Complete the check to continue.",
        headers: buildHeaders(),
        waitForCookie: "cf_clearance",
        timeoutMs: 60000,
      });

      await store(providerContext, result.cookies || "", result.userAgent || "");

      if (result.data && !isChallenge(result.data)) return result.data;

      const retry = await axios.get(url, {
        headers: {
          ...emHeaders,
          Referer: referer || origin + "/",
          "User-Agent": result.userAgent || emHeaders["User-Agent"],
          Cookie: result.cookies || "",
        },
        signal,
      });
      return typeof retry.data === "string" ? retry.data : "";
    } catch (err) {
      console.error("extraMovies WAF solver failed:", err);
    }
  }

  throw new Error(
    `extraMovies request blocked: ${url}. Open the provider in the app to solve the check, or set a working mirror in provider settings.`,
  );
}

/** Headers for the hubcloud extractor (it mutates the object, so pass a copy). */
export async function extractorHeaders(
  providerContext: ProviderContext,
): Promise<Record<string, string>> {
  const stored = await getStored(providerContext);
  const h: Record<string, string> = { ...emHeaders };
  if (stored.cookie) h.Cookie = stored.cookie;
  if (stored.userAgent) h["User-Agent"] = stored.userAgent;
  return h;
}

export function absoluteUrl(href: string, baseUrl: string): string {
  if (!href) return "";
  const trimmed = href
    .replace(/&amp;/gi, "&")
    .replace(/&#0?38;/g, "&")
    .trim();
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return baseUrl.replace(/\/+$/, "") + trimmed;
  return `${baseUrl.replace(/\/+$/, "")}/${trimmed}`;
}

/** Strips WordPress thumbnail suffixes so we get the full-size poster. */
export function fullSizeImage(url: string): string {
  return (url || "").replace(/-\d{2,4}x\d{2,4}(\.\w{3,4})(\?|$)/i, "$1$2");
}
