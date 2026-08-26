import { ProviderContext } from "../types";

export const DEFAULT_BASE_URL = "https://yomovies.energy";

export const yoHeaders: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

/**
 * Resolves the base url, honouring the user provided override in settings
 * (`yomoviesBaseUrl`) and caching the last working value in the kv store.
 */
export async function getBaseUrl(
  providerContext: ProviderContext,
): Promise<string> {
  try {
    const override = await providerContext.kvStore.get<string>(
      "yomoviesBaseUrl",
    );
    if (override && override.trim()) {
      return override.trim().replace(/\/+$/, "");
    }
  } catch {
    // kvStore may be unavailable in some sandboxes - fall through
  }
  return DEFAULT_BASE_URL;
}

export function absoluteUrl(href: string, baseUrl: string): string {
  if (!href) return "";
  if (href.startsWith("//")) return "https:" + href;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return baseUrl + href;
  return `${baseUrl}/${href}`;
}

/** Detects whether a yomovies post is a series (season / episode listing). */
export function isSeriesTitle(title: string): boolean {
  return /\b(season|episode|series|ep\s?\d|s\d{1,2}\s?e\d{1,2})\b/i.test(
    title || "",
  );
}

export function qualityFromText(
  text: string,
): "360" | "480" | "720" | "1080" | "2160" | undefined {
  const t = (text || "").toLowerCase();
  if (/2160|4k|uhd/.test(t)) return "2160";
  if (/1080|fhd/.test(t)) return "1080";
  if (/720/.test(t)) return "720";
  if (/480/.test(t)) return "480";
  if (/360|240/.test(t)) return "360";
  return undefined;
}

/** Unpacks `eval(function(p,a,c,k,e,d){...})` obfuscated player scripts. */
export function unpack(source: string): string {
  try {
    const match = source.match(
      /}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\s*\.split\('\|'\)/,
    );
    if (!match) return "";
    const payload = match[1]
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"');
    const radix = parseInt(match[2], 10);
    const count = parseInt(match[3], 10);
    const words = match[4].split("|");

    const toBase = (num: number): string => {
      const chars =
        "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      let result = "";
      let n = num;
      if (n === 0) return "0";
      while (n > 0) {
        result = chars[n % radix] + result;
        n = Math.floor(n / radix);
      }
      return result;
    };

    const dict: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      const key = toBase(i);
      dict[key] = words[i] && words[i].length ? words[i] : key;
    }

    return payload.replace(/\b\w+\b/g, (word) =>
      Object.prototype.hasOwnProperty.call(dict, word) ? dict[word] : word,
    );
  } catch {
    return "";
  }
}

/** Pulls every m3u8 / mp4 url out of an arbitrary blob of html / js. */
export function findVideoUrls(html: string): string[] {
  const found: string[] = [];
  const push = (u?: string | null) => {
    if (!u) return;
    let url = u.replace(/\\\//g, "/").trim();
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) return;
    if (!found.includes(url)) found.push(url);
  };

  const regexes = [
    /["'](https?:[^"'\s\\]+\.m3u8[^"'\s\\]*)["']/gi,
    /["'](https?:[^"'\s\\]+\.mp4[^"'\s\\]*)["']/gi,
    /file\s*:\s*["']([^"']+)["']/gi,
    /source\s*:\s*["']([^"']+)["']/gi,
    /src\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
  ];

  for (const re of regexes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (/\.(m3u8|mp4)/i.test(m[1])) push(m[1]);
    }
  }
  return found;
}
