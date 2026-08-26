import { ProviderContext, Stream } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  absoluteUrl,
  fetchPage,
  getBaseUrl,
  PROVIDER_NAME,
  yoHeaders,
} from "./client";
import {
  decodeUrlEntities,
  findVideoUrls,
  isAdaptiveMaster,
  qualityFromText,
  unpack,
} from "./utils";

function serverNameFromUrl(url: string): string {
  try {
    const host = (url.split("/")[2] || "").replace(/^www\./, "");
    const name = host.split(".")[0] || host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "Server";
  }
}

/**
 * Resolves a file-host / embed page (speedostream, netu, streamlare, ...)
 * into playable urls. Handles both plain `sources:[{file:...}]` players and
 * `eval(function(p,a,c,k,e,d))` packed players.
 */
async function resolveEmbed({
  embedUrl,
  referer,
  providerContext,
  signal,
}: {
  embedUrl: string;
  referer: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Stream[]> {
  const { axios } = providerContext;
  const streams: Stream[] = [];
  const origin = embedUrl.split("/").slice(0, 3).join("/");
  const server = serverNameFromUrl(embedUrl);

  try {
    const res = await axios.get(embedUrl, {
      headers: {
        ...yoHeaders,
        Referer: referer,
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
      },
      signal,
    });

    let html: string = typeof res.data === "string" ? res.data : "";
    if (!html) return streams;

    if (/File Not Found|no longer available|could not be found/i.test(html)) {
      console.log(`yomovies: ${server} file expired - skipping`);
      return streams;
    }

    let candidates = findVideoUrls(html);

    // packed player payload
    if (!candidates.length && /eval\(function\(p,a,c,k,e,/.test(html)) {
      const unpacked = unpack(html);
      if (unpacked) candidates = findVideoUrls(unpacked);
    }

    // some hosts POST to a /dl or /api endpoint - follow one level of iframe
    if (!candidates.length) {
      const innerIframe = html.match(
        /<iframe[^>]+src=["']([^"']+)["']/i,
      )?.[1];
      if (innerIframe) {
        const nested = absoluteUrl(innerIframe, origin);
        if (nested !== embedUrl) {
          return await resolveEmbed({
            embedUrl: nested,
            referer: embedUrl,
            providerContext,
            signal,
          });
        }
      }
    }

    for (const raw of candidates) {
      const url = decodeUrlEntities(raw);
      const isHls = /\.m3u8/i.test(url.split("?")[0]);

      // The CDN host is usually NOT the embed host (e.g. embed on
      // speedostream1.com, media on mishai.ydc1wes.me). Signed urls are
      // validated against the *embed* origin, so that is what we must send.
      streams.push({
        server,
        link: url,
        type: isHls ? "m3u8" : "mp4",
        // never pin a resolution on an adaptive master playlist - the player
        // picks the rendition itself from the variant list.
        quality: isAdaptiveMaster(url) ? undefined : qualityFromText(url),
        headers: {
          Referer: origin + "/",
          Origin: origin,
          "User-Agent": yoHeaders["User-Agent"],
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    }
  } catch (err) {
    console.error(`yomovies resolveEmbed failed for ${embedUrl}:`, err);
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
  const { cheerio } = providerContext;

  try {
    const baseUrl = await getBaseUrl(providerContext);
    const siteHost = new URL(baseUrl).host;
    let streams: Stream[] = [];

    const isSitePage =
      link.includes(siteHost) || /yomovies|prmovies/i.test(link);

    if (isSitePage) {
      // meta gave us the movie page - harvest its embeds first
      const html = await fetchPage({
        url: link,
        providerContext,
        signal,
        referer: baseUrl + "/",
      });
      const $ = cheerio.load(html || "");

      const embeds: string[] = [];
      $("iframe[src], iframe[data-src]").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("data-src") || "";
        if (src) embeds.push(absoluteUrl(src, baseUrl));
      });
      $("#list-dl a[href], .mvic-dl a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (/^https?:\/\//i.test(href) && !href.includes(siteHost)) {
          embeds.push(href);
        }
      });

      for (const embed of Array.from(new Set(embeds))) {
        if (!embed || embed.includes(siteHost)) continue;
        streams = streams.concat(
          await resolveEmbed({
            embedUrl: embed,
            referer: baseUrl + "/",
            providerContext,
            signal,
          }),
        );
      }
    } else {
      streams = await resolveEmbed({
        embedUrl: link,
        referer: baseUrl + "/",
        providerContext,
        signal,
      });
    }

    // de-duplicate
    const seen = new Set<string>();
    streams = streams.filter((s) => {
      if (seen.has(s.link)) return false;
      seen.add(s.link);
      return true;
    });

    const rank = (s: Stream) => Number(s.quality || 0);

    if (isDownload) {
      // progressive mp4 downloads better than HLS
      streams.sort((a, b) => {
        const d = (b.type === "mp4" ? 1 : 0) - (a.type === "mp4" ? 1 : 0);
        return d !== 0 ? d : rank(b) - rank(a);
      });
    } else {
      streams.sort((a, b) => {
        const d = (b.type === "m3u8" ? 1 : 0) - (a.type === "m3u8" ? 1 : 0);
        return d !== 0 ? d : rank(b) - rank(a);
      });
    }

    return streams;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getStream", err);
  }
};
