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

/**
 * Headers the video player must replay on EVERY request it makes (master
 * playlist, variant playlists and each segment).
 *
 * Deliberately NO `Origin` header: netu/speedostream CDNs treat a request
 * carrying `Origin` as a browser XHR and enforce a CORS allow-list, answering
 * 403 to anything that is not the embed page itself. A downloader issues one
 * plain GET and succeeds, while the player's segment requests get rejected -
 * which is exactly the "download works, streaming doesn't" symptom. Only
 * `Referer` is required for the token check, and that is what the vast
 * majority of working vega providers send.
 */
function playbackHeaders(origin: string): Record<string, string> {
  return {
    Referer: origin + "/",
    "User-Agent": yoHeaders["User-Agent"],
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/**
 * A `,l,h,x,.urlset/master.m3u8` playlist lists the individual renditions.
 * Some players choke on that indirection (or on the comma-heavy path), so we
 * also expose each variant as its own selectable stream, mirroring what the
 * anikoto / kickAssAnime providers do.
 */
async function expandMasterPlaylist({
  masterUrl,
  server,
  headers,
  providerContext,
  signal,
}: {
  masterUrl: string;
  server: string;
  headers: Record<string, string>;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Stream[]> {
  const { axios } = providerContext;
  const variants: Stream[] = [];

  try {
    const res = await axios.get(masterUrl, { headers, signal, timeout: 8000 });
    const body: string = typeof res.data === "string" ? res.data : "";
    if (!body.includes("#EXT-X-STREAM-INF")) return variants;

    const lines = body.split("\n");
    const dir = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("#EXT-X-STREAM-INF")) continue;

      const height = (line.match(/RESOLUTION=\d+x(\d+)/) || [])[1];
      let next = (lines[i + 1] || "").trim();
      if (!next || next.startsWith("#")) continue;

      next = decodeUrlEntities(next);
      const variantUrl = /^https?:\/\//i.test(next)
        ? next
        : dir + next.replace(/^\.?\//, "");

      variants.push({
        server: height ? `${server} ${height}p` : server,
        link: variantUrl,
        type: "m3u8",
        quality: height ? nearestQuality(height) : undefined,
        headers,
      });
    }
  } catch (err) {
    console.log("yomovies: could not expand master playlist:", err);
  }

  return variants;
}

function nearestQuality(
  height: string,
): "360" | "480" | "720" | "1080" | "2160" | undefined {
  const h = parseInt(height, 10);
  if (!h) return undefined;
  if (h >= 1800) return "2160";
  if (h >= 900) return "1080";
  if (h >= 650) return "720";
  if (h >= 400) return "480";
  return "360";
}

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

    // The media host is usually NOT the embed host (embed on
    // speedostream1.com, media on mishai.ydc1wes.me). The signed token is
    // checked against the *embed* origin, so that is the Referer we send.
    const headers = playbackHeaders(origin);

    for (const raw of candidates) {
      const url = decodeUrlEntities(raw);
      const isHls = /\.m3u8/i.test(url.split("?")[0]);

      streams.push({
        server,
        link: url,
        type: isHls ? "m3u8" : "mp4",
        // never pin a resolution on an adaptive master playlist - the player
        // picks the rendition itself from the variant list.
        quality: isAdaptiveMaster(url) ? undefined : qualityFromText(url),
        headers,
      });

      // Expose the individual renditions too, so the user has a fallback if
      // the adaptive master fails to start in the player.
      if (isHls && isAdaptiveMaster(url)) {
        const variants = await expandMasterPlaylist({
          masterUrl: url,
          server,
          headers,
          providerContext,
          signal,
        });
        streams.push(...variants);
      }
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
      // For playback the adaptive master must come first: the app plays
      // streams[0] and the master lets the player pick a rendition. Variants
      // follow as manual fallbacks, then any progressive mp4.
      streams.sort((a, b) => {
        const score = (s: Stream) => {
          if (s.type === "m3u8" && isAdaptiveMaster(s.link)) return 3;
          if (s.type === "m3u8") return 2;
          return 1;
        };
        const d = score(b) - score(a);
        return d !== 0 ? d : rank(b) - rank(a);
      });
    }

    return streams;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getStream", err);
  }
};
