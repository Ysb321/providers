import { ProviderContext, Stream } from "../types";
import { throwProviderError } from "../providerErrors";
import { hubcloudExtractor } from "../extractors/hubcloud";
import { gofileExtractor } from "../extractors/gofile";
import {
  extractorHeaders,
  fetchPage,
  getBaseUrl,
  PROVIDER_NAME,
} from "./client";

const HUBCLOUD_HOSTS =
  /(hubcloud|hubdrive|vcloud|gdflix|gdlink|filepress|gdtot|driveleech|driveseed)/i;

/**
 * Servers that can only be downloaded, never streamed. The app uses this to
 * avoid handing an unplayable link to the video player.
 */
export const nonStreamableServer = ["G-Drive (download only)", "Gofile"];

/** Rough playability score - HLS/direct mp4 play best, archives never do. */
function isPlayable(stream: Stream): boolean {
  const server = (stream.server || "").toLowerCase();
  if (nonStreamableServer.some((s) => server === s.toLowerCase())) return false;
  if (/download only/i.test(stream.server || "")) return false;
  return true;
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

  try {
    const baseUrl = await getBaseUrl(providerContext);
    let target = link;

    // If we were handed a site page rather than a file host, pull the first
    // supported download link out of it.
    if (target.includes(new URL(baseUrl).host)) {
      const html = await fetchPage({
        url: target,
        providerContext,
        signal,
        referer: baseUrl + "/",
      });
      const $ = cheerio.load(html || "");
      let found = "";
      $("a[href]").each((_, el) => {
        if (found) return;
        const href = $(el).attr("href") || "";
        if (HUBCLOUD_HOSTS.test(href) || /gofile\.io/i.test(href)) found = href;
      });
      if (!found) return [];
      target = found;
    }

    const headers = await extractorHeaders(providerContext);
    let streams: Stream[] = [];

    if (/gofile\.io/i.test(target)) {
      // gofileExtractor takes the content id (last path segment), not the url,
      // and returns { link, token } - the token must ride along as a cookie.
      const contentId = target.split("/").filter(Boolean).pop() || "";
      const gf = await gofileExtractor(contentId, axios, providerContext);
      if (gf?.link) {
        streams = [
          {
            server: "Gofile",
            link: gf.link,
            type: "mkv",
            headers: {
              Cookie: `accountToken=${gf.token}`,
              "User-Agent": headers["User-Agent"],
            },
          },
        ];
      }
    } else {
      // hubcloud/vcloud/gdflix all funnel through the shared extractor, which
      // already handles their redirect chains, WAF and mirror fallbacks.
      const result = await hubcloudExtractor(
        target,
        signal as AbortSignal,
        axios,
        cheerio,
        headers,
        providerContext,
        isDownload,
        PROVIDER_NAME,
      );
      if (Array.isArray(result)) streams = result as Stream[];
    }

    streams = (streams || []).filter((s) => s && s.link);

    // de-duplicate
    const seen = new Set<string>();
    streams = streams.filter((s) => {
      if (seen.has(s.link)) return false;
      seen.add(s.link);
      return true;
    });

    if (isDownload) {
      // Download-only mirrors are usually the fastest for saving a file.
      streams.sort(
        (a, b) => Number(isPlayable(a)) - Number(isPlayable(b)),
      );
    } else {
      // Streaming: put genuinely playable servers first.
      streams.sort(
        (a, b) => Number(isPlayable(b)) - Number(isPlayable(a)),
      );
    }

    return streams;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getStream", err);
  }
};
