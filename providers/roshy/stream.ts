import { Stream, ProviderContext } from "../types";

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
  const { axios, cheerio, commonHeaders } = providerContext;

  try {
    // Direct link already points at a media file/iframe.
    if (/\.(m3u8|mp4|mkv|webm)(\?.*)?$/i.test(link)) {
      return [
        {
          server: "Roshy",
          link,
          type: /\.m3u8/i.test(link) ? "m3u8" : "mp4",
          quality: "1080",
        },
      ];
    }

    const response = await axios.get(link, {
      headers: {
        ...commonHeaders,
        Referer: link,
      },
      signal,
    });
    const $ = cheerio.load(response.data || "");

    const streams: Stream[] = [];
    const seen = new Set<string>();

    // iframe / video embeds.
    $("iframe[src], embed[src], video source[src]").each((_, el) => {
      const src = $(el).attr("src") || $(el).find("source").attr("src") || "";
      if (!src || seen.has(src)) return;
      seen.add(src);
      streams.push({
        server: isDownload ? "Download" : `Server ${streams.length + 1}`,
        link: src,
        type: src.includes(".m3u8") ? "m3u8" : "iframe",
      });
    });

    // Fallback: search the raw HTML for a video/blob URL.
    if (streams.length === 0) {
      const html = String(response.data || "");
      const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
      if (m3u8Match) {
        streams.push({
          server: isDownload ? "Download" : "Roshy",
          link: m3u8Match[0],
          type: "m3u8",
        });
      }
    }

    return streams;
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error(`Roshy stream error: ${error?.message || error}`);
    return [];
  }
};
