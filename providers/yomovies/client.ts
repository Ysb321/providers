import { ProviderContext } from "../types";

export const PROVIDER_NAME = "yomovies";
export const DEFAULT_BASE_URL = "https://yomovies.energy";

const COOKIE_KEY = "yomoviesCfCookie";
const UA_KEY = "yomoviesCfUserAgent";

export const yoHeaders: Record<string, string> = {
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

/** Base url, honouring the user override stored in settings. */
export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  try {
    const override =
      await providerContext.kvStore.get<string>("yomoviesBaseUrl");
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

/** Cloudflare clearance cookies previously solved by the WebView. */
async function getStoredCookie(
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

async function storeCookie(
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
    !/ml-item|mvic-desc|movies-list/i.test(body)
  );
}

/**
 * GET a yomovies url. The site is behind Cloudflare, so a plain request often
 * comes back as a 403 interstitial. In that case we hand the url to the app's
 * WebView so the user (or the WebView itself) can clear the challenge, then we
 * cache `cf_clearance` for subsequent requests.
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
  const stored = await getStoredCookie(providerContext);

  const buildHeaders = (extra?: Record<string, string>) => {
    const h: Record<string, string> = {
      ...yoHeaders,
      Referer: referer || origin + "/",
      ...(extra || {}),
    };
    if (stored.cookie && !h.Cookie) h.Cookie = stored.cookie;
    if (stored.userAgent) h["User-Agent"] = stored.userAgent;
    return h;
  };

  // 1) plain request (with cached clearance cookie when we have one)
  try {
    const res = await axios.get(url, {
      headers: buildHeaders(),
      signal,
      // let us inspect 403 bodies instead of throwing straight away
      validateStatus: (status: number) => status < 500,
    });
    if (res.status < 400 && !isChallenge(res.data)) {
      return typeof res.data === "string" ? res.data : "";
    }
  } catch (err) {
    // fall through to the WebView solver
  }

  // 2) Cloudflare blocked us - solve it in the app WebView
  if (typeof openWebView === "function") {
    try {
      const result = await openWebView(url, {
        title: "Verifying with yomovies",
        description:
          "Cloudflare protection detected. Complete the check to continue.",
        headers: buildHeaders(),
        waitForCookie: "cf_clearance",
        timeoutMs: 60000,
      });

      await storeCookie(
        providerContext,
        result.cookies || "",
        result.userAgent || "",
      );

      // The WebView already returns the rendered document - use it directly
      if (result.data && !isChallenge(result.data)) {
        return result.data;
      }

      const retry = await axios.get(url, {
        headers: {
          ...yoHeaders,
          Referer: referer || origin + "/",
          "User-Agent": result.userAgent || yoHeaders["User-Agent"],
          Cookie: result.cookies || "",
        },
        signal,
      });
      return typeof retry.data === "string" ? retry.data : "";
    } catch (err) {
      console.error("yomovies WAF solver failed:", err);
    }
  }

  throw new Error(
    `yomovies request blocked by Cloudflare: ${url}. Open the provider once in the app to solve the check, or set a working mirror in provider settings.`,
  );
}

export function absoluteUrl(href: string, baseUrl: string): string {
  if (!href) return "";
  // markup often contains `&amp;` inside urls - normalise it here so query
  // strings (signed tokens, ids) survive intact.
  const trimmed = href
    .replace(/&amp;/gi, "&")
    .replace(/&#0?38;/g, "&")
    .trim();
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return baseUrl.replace(/\/+$/, "") + trimmed;
  return `${baseUrl.replace(/\/+$/, "")}/${trimmed}`;
}
