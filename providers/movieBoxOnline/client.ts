import { ProviderContext } from "../types";

export const PROVIDER_NAME = "movieBoxOnline";
export const DEFAULT_BASE_URL = "https://movieboxonline.net";

/**
 * The site is a Nuxt front-end over the shared `wefeed-h5api-bff` backend
 * (same family as the reference movieBoxWeb provider, but with different
 * public routes: detail pages live at /movies/<detailPath>, not
 * /moviesDetail/<detailPath>).
 */
export const apiHeaders: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "x-client-info": JSON.stringify({ timezone: "Asia/Kolkata" }),
  "x-source": "",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

export const pageHeaders: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": apiHeaders["User-Agent"],
};

export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  try {
    const override =
      await providerContext.kvStore.get<string>("movieBoxOnlineBaseUrl");
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

export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

/** Public watch/detail page for a title - used as the API Referer. */
export function detailUrl(baseUrl: string, detailPath: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/movies/${detailPath}`;
}

/** GETs a JSON API endpoint and unwraps the `{code,message,data}` envelope. */
export async function getJson<T = any>({
  url,
  providerContext,
  signal,
  referer,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
  referer?: string;
}): Promise<T> {
  const { axios } = providerContext;
  const res = await axios.get(url, {
    headers: { ...apiHeaders, ...(referer ? { Referer: referer } : {}) },
    signal,
  });

  const payload =
    typeof res.data === "string" ? safeParse(res.data) : (res.data as any);

  if (!payload || typeof payload !== "object") {
    throw new Error(`unexpected response from ${url}`);
  }
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(
      `${payload.message || payload.reason || "API error"} (code ${payload.code}) | ${url}`,
    );
  }
  return (payload.data ?? payload) as T;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Fetches an HTML page (used for search, which has no public JSON endpoint). */
export async function getHtml({
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
  const { axios } = providerContext;
  const res = await axios.get(url, {
    headers: { ...pageHeaders, ...(referer ? { Referer: referer } : {}) },
    signal,
  });
  return typeof res.data === "string" ? res.data : "";
}

/** Strips the aoneroom CDN resize suffix so posters come back full size. */
export function fullImage(url?: string): string {
  if (!url) return "";
  return url.split("?")[0];
}
