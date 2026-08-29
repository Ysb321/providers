import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";

export async function getStream({
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
  try {
    const { axios, cheerio, commonHeaders } = providerContext;

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

    // Otherwise fetch the page and look for an embed/iframe or inline source.
    const response = await axios.get(link, {
      headers: {
        ...commonHeaders,
        Referer: link,
      },
      signal,
    });
    const $ = cheerio.load(response.data || "");

    const streams: Stream[] = [];
    const serverKeys: string[] = [];

    // iframe embeds (e.g. streaming player)
    $("iframe[src], embed[src], video source[src]").each((_, el) => {
      const src =
        $(el).attr("src") ||
        $(el).find("source").attr("src") ||
        "";
      if (!src) return;
      const serverName = isDownload
        ? "Download"
        : `Server ${serverKeys.length + 1}`;
      streams.push({
        server: serverName,
        link: src,
        type: src.includes(".m3u8") ? "m3u8" : "iframe",
      });
      serverKeys.push(src);
    });

    // Fallback: search raw HTML for a video/blob URL.
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
  } catch (err) {
    throwProviderError("Roshy", "stream", err);
    return [];
  }
}
