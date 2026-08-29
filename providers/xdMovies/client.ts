import { ProviderContext } from "../types";

export const PROVIDER_NAME = "xdMovies";
export const DEFAULT_BASE_URL = "https://top.xdmovies.wtf";

const COOKIE_KEY = "xdMoviesCfCookie";
const UA_KEY = "xdMoviesCfUserAgent";

export const xdHeaders: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  try {
    const override =
      await providerContext.kvStore.get<string>("xdMoviesBaseUrl");
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
    !/xdmovies|Download Links|\/movies\/|\/series\//i.test(body)
  );
}

/** GETs a site page, solving a Cloudflare interstitial via the app WebView. */
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
      ...xdHeaders,
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
        title: "Verifying with XDMovies",
        description:
          "Cloudflare protection detected. Complete the check to continue.",
        headers: buildHeaders(),
        waitForCookie: "cf_clearance",
        timeoutMs: 60000,
      });
      await store(providerContext, result.cookies || "", result.userAgent || "");
      if (result.data && !isChallenge(result.data)) return result.data;
    } catch (err) {
      console.error("xdMovies WAF solver failed:", err);
    }
  }

  throw new Error(
    `xdMovies request blocked: ${url}. Open the provider in the app to solve the check, or set a working mirror in provider settings.`,
  );
}

export function absoluteUrl(href: string, baseUrl: string): string {
  if (!href) return "";
  const trimmed = href.replace(/&amp;/gi, "&").trim();
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return baseUrl.replace(/\/+$/, "") + trimmed;
  return `${baseUrl.replace(/\/+$/, "")}/${trimmed}`;
}

/** Pulls "2160p"/"1080p"/... out of a release filename or label. */
export function qualityOf(text: string): string | undefined {
  const t = (text || "").toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(t)) return "2160p";
  if (/1080p/.test(t)) return "1080p";
  if (/720p/.test(t)) return "720p";
  if (/480p/.test(t)) return "480p";
  return undefined;
}

export function qualityRank(q?: string): number {
  const n = parseInt((q || "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
