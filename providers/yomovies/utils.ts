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
    let url = u.replace(/\\\//g, "/").trim();
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) return;
    if (!/\.(m3u8|mp4)/i.test(url)) return;
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
