import { ProviderContext, Stream } from "../types";
import {
  findVideoUrls,
  getBaseUrl,
  qualityFromText,
  unpack,
  yoHeaders,
} from "./utils";

function serverNameFromUrl(url: string): string {
  try {
    const host = url.split("/")[2] || "";
    const parts = host.replace(/^www\./, "").split(".");
    const name = parts[0] || host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "Server";
  }
}

/** Follows an embed / file-host page and extracts the playable urls. */
async function resolveEmbed(
  embedUrl: string,
  refererBase: string,
  providerContext: ProviderContext,
  signal?: AbortSignal,
): Promise<Stream[]> {
  const { axios } = providerContext;
  const streams: Stream[] = [];

  try {
    const res = await axios.get(embedUrl, {
      headers: {
        ...yoHeaders,
        Referer: refererBase,
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Site": "cross-site",
      },
      signal,
    });

    const html: string = typeof res.data === "string" ? res.data : "";
    if (!html) return streams;

    // speedostream / netu style pages hide the source in a packed script
    let candidates = findVideoUrls(html);
    if (!candidates.length && /eval\(function\(p,a,c,k,e,/.test(html)) {
      const packedMatch = html.match(
        /eval\(function\(p,a,c,k,e,[\s\S]*?\)\)\s*;?/,
      );
      if (packedMatch) {
        const unpacked = unpack(packedMatch[0]);
        candidates = findVideoUrls(unpacked);
      }
    }

    const origin = embedUrl.split("/").slice(0, 3).join("/");
    const server = serverNameFromUrl(embedUrl);

    for (const url of candidates) {
      const isHls = /\.m3u8/i.test(url);
      streams.push({
        server,
        link: url,
        type: isHls ? "m3u8" : "mp4",
        quality: qualityFromText(url),
        headers: {
          Referer: origin + "/",
          Origin: origin,
          "User-Agent": yoHeaders["User-Agent"],
        },
      });
    }
  } catch (err) {
    console.error("yomovies resolveEmbed error:", embedUrl, err);
  }

  return streams;
}

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  const { axios, cheerio } = providerContext;
  const baseUrl = await getBaseUrl(providerContext);

  try {
    let streams: Stream[] = [];

    // If the link is still a yomovies page, harvest its embeds first.
    if (link.includes(new URL(baseUrl).host) || link.includes("yomovies")) {
      const res = await axios.get(link, {
        headers: { ...yoHeaders, Referer: baseUrl + "/" },
        signal,
      });
      const $ = cheerio.load(res.data || "");

      const embeds: string[] = [];
      $("iframe").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("data-src") || "";
        if (src && /^https?:|^\/\//.test(src)) {
          embeds.push(src.startsWith("//") ? "https:" + src : src);
        }
      });
      $("#list-dl a, .mvic-dl a").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (/^https?:\/\//i.test(href) && !href.includes("yomovies")) {
          embeds.push(href);
        }
      });

      for (const embed of Array.from(new Set(embeds))) {
        const resolved = await resolveEmbed(
          embed,
          baseUrl + "/",
          providerContext,
          signal,
        );
        streams = streams.concat(resolved);
      }
    } else {
      streams = await resolveEmbed(link, baseUrl + "/", providerContext, signal);
    }

    // De-duplicate
    const seen = new Set<string>();
    streams = streams.filter((s) => {
      if (seen.has(s.link)) return false;
      seen.add(s.link);
      return true;
    });

    const qualityRank = (s: Stream) => Number(s.quality || 0);

    if (isDownload) {
      // progressive mp4 first - better suited for downloading
      streams.sort((a, b) => {
        const aMp4 = a.type === "mp4" ? 1 : 0;
        const bMp4 = b.type === "mp4" ? 1 : 0;
        if (aMp4 !== bMp4) return bMp4 - aMp4;
        return qualityRank(b) - qualityRank(a);
      });
    } else {
      // hls first - adaptive, best for streaming
      streams.sort((a, b) => {
        const aHls = a.type === "m3u8" ? 1 : 0;
        const bHls = b.type === "m3u8" ? 1 : 0;
        if (aHls !== bHls) return bHls - aHls;
        return qualityRank(b) - qualityRank(a);
      });
    }

    return streams;
  } catch (err) {
    console.error("yomovies getStream error:", err);
    return [];
  }
};
