/** Detects whether a yomovies post is a series (season / episode listing). */
export function isSeriesTitle(title: string): boolean {
  return /\b(season|episode|series|ep\s?\d|s\d{1,2}\s?e\d{1,2})\b/i.test(
    title || "",
  );
}

/**
 * Decodes HTML entities found in urls scraped out of page markup.
 * Critical for CDN links: a literal `&amp;` between query params invalidates
 * the signed token (`?t=...&s=...&e=...`) and the CDN answers 403, so the
 * player just spins / fails.
 */
export function decodeUrlEntities(url: string): string {
  return (url || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&#x0?26;/gi, "&")
    .replace(/&quot;/gi, "")
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .trim();
}

/**
 * Guesses the resolution from a url/label. Only the path and explicit quality
 * tokens are considered - query strings hold timestamps and ids (e.g.
 * `e=21600`, `f=53245`) that would otherwise be misread as resolutions.
 */
export function qualityFromText(
  text: string,
): "360" | "480" | "720" | "1080" | "2160" | undefined {
  if (!text) return undefined;
  // strip the query string before sniffing
  // underscores are word chars, so normalise separators before matching
  const t = text.split("?")[0].toLowerCase().replace(/[_\-.]/g, " ");
  if (/(^|\W)(2160p?|4k|uhd)(\W|$)/.test(t)) return "2160";
  if (/(^|\W)(1080p?|fhd)(\W|$)/.test(t)) return "1080";
  if (/(^|\W)720p?(\W|$)/.test(t)) return "720";
  if (/(^|\W)480p?(\W|$)/.test(t)) return "480";
  if (/(^|\W)(360|240)p?(\W|$)/.test(t)) return "360";
  return undefined;
}

/**
 * netu/speedostream serve multi-variant playlists such as
 * `/hls2/01/00010/xxxx_,l,h,x,.urlset/master.m3u8`. The `,l,h,x,` part lists
 * the available renditions, so the master playlist is adaptive - we must not
 * pin a single resolution on it.
 */
export function isAdaptiveMaster(url: string): boolean {
  return /\.urlset\/|master\.m3u8|index-v1-a1\.m3u8|playlist\.m3u8/i.test(
    url || "",
  );
}

/**
 * Unpacks `eval(function(p,a,c,k,e,d){...})` player scripts.
 * Same approach as the supeVideo extractor in vega-providers.
 */
export function unpack(source: string): string {
  try {
    const functionRegex =
      /eval\(function\((.*?)\)\{.*?return p\}.*?\('(.*?)'\.split/;
    const match = functionRegex.exec(source);
    if (!match) return "";

    const encodedString = match[2];
    const parts = encodedString.split("',36,");
    if (parts.length < 2) return "";

    let p = parts[0].trim();
    const radix = 36;
    const words = parts[1].slice(2).split("|");
    let c = words.length;

    while (c--) {
      if (words[c]) {
        const re = new RegExp("\\b" + c.toString(radix) + "\\b", "g");
        p = p.replace(re, words[c]);
      }
    }
    return p;
  } catch (err) {
    console.error("yomovies unpack error:", err);
    return "";
  }
}

/** Pulls every m3u8 / mp4 url out of an arbitrary blob of html / js. */
export function findVideoUrls(html: string): string[] {
  const found: string[] = [];
  const push = (u?: string | null) => {
    if (!u) return;
    // decode entities BEFORE validating - signed CDN urls arrive as
    // `...master.m3u8?t=abc&amp;s=123&amp;e=21600` and must be normalised.
    let url = decodeUrlEntities(u);
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) return;
    if (!/\.(m3u8|mp4)(\?|$|&)/i.test(url) && !/\.(m3u8|mp4)/i.test(url))
      return;
    if (!found.includes(url)) found.push(url);
  };

  const regexes = [
    /["'](https?:[^"'\s\\]+\.m3u8[^"'\s\\]*)["']/gi,
    /["'](https?:[^"'\s\\]+\.mp4[^"'\s\\]*)["']/gi,
    /file\s*:\s*["']([^"']+)["']/gi,
    /source\s*:\s*["']([^"']+)["']/gi,
    /src\s*:\s*["']([^"']+)["']/gi,
    /sources\s*:\s*\[\s*\{[^}]*?["']?(?:file|src)["']?\s*:\s*["']([^"']+)["']/gi,
  ];

  for (const re of regexes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) push(m[1]);
  }
  return found;
}
