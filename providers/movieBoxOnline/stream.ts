import { ProviderContext, Stream, TextTracks } from "../types";
import { throwProviderError } from "../providerErrors";
import { PROVIDER_NAME, apiUrl, detailUrl, getBaseUrl, getJson } from "./client";

type PlayStream = {
  format?: string;
  id?: string;
  url?: string;
  resolutions?: string;
  vipLocked?: boolean;
};

type Caption = { lan?: string; lanName?: string; url?: string };

type Playback = {
  subjectId: string;
  detailPath: string;
  season?: number;
  episode?: number;
};

function decodePlayback(link: string): Playback {
  try {
    const parsed = JSON.parse(link);
    if (parsed && typeof parsed === "object" && parsed.detailPath) {
      return parsed as Playback;
    }
  } catch {
    /* not JSON - fall through */
  }
  // Tolerate a bare detailPath / URL so the link still resolves.
  const detailPath = link
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/(movies|moviesDetail)\//, "")
    .replace(/^\/+/, "")
    .split(/[?#]/)[0];
  return { subjectId: "", detailPath };
}

function getQuality(resolutions?: string): Stream["quality"] {
  const values = (resolutions || "")
    .split(",")
    .map((v) => parseInt(v, 10))
    .filter((v) => [360, 480, 720, 1080, 2160].includes(v));
  if (!values.length) return undefined;
  return String(Math.max(...values)) as Stream["quality"];
}

function getStreamType(format?: string, url?: string): string {
  const normalized = (format || "").toUpperCase();
  if (normalized === "HLS" || normalized === "M3U8") return "m3u8";
  if (normalized === "DASH" || normalized === "MPD") return "mpd";
  const clean = (url || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "m3u8";
  if (clean.endsWith(".mpd")) return "mpd";
  return "mp4";
}

function mapCaptions(captions: Caption[]): TextTracks {
  return captions
    .filter((c) => Boolean(c.url))
    .map((c) => ({
      title: c.lanName || c.lan || "Subtitle",
      language: c.lan || "und",
      type: (c.url || "").includes(".vtt")
        ? ("text/vtt" as const)
        : ("application/x-subrip" as const),
      uri: c.url || "",
    }));
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
  try {
    const baseUrl = await getBaseUrl(providerContext);
    const playback = decodePlayback(link);

    // The API validates against the public watch page, so send it as Referer.
    const referer = detailUrl(baseUrl, playback.detailPath);

    const params = new URLSearchParams({ detailPath: playback.detailPath });
    if (playback.subjectId) params.set("subjectId", playback.subjectId);
    if (playback.season && playback.episode) {
      params.set("se", String(playback.season));
      params.set("ep", String(playback.episode));
    }

    const data = await getJson<any>({
      url: apiUrl(baseUrl, `/wefeed-h5api-bff/subject/play?${params}`),
      providerContext,
      signal,
      referer,
    });

    if (!data || data.hasResource === false) {
      throw new Error(
        `no playable resource for this title (the API reported hasResource=false)`,
      );
    }

    const sources: PlayStream[] = [
      ...(data.streams || []),
      ...(data.hls || []),
      ...(data.dash || []),
    ];

    const usable = sources.filter((s) => s.url && !s.vipLocked);
    if (!usable.length) {
      const locked = sources.some((s) => s.vipLocked);
      throw new Error(
        locked
          ? "all sources for this title are VIP-locked"
          : "the play API returned no sources",
      );
    }

    // Captions are shared per title - fetch once rather than per source.
    let subtitles: TextTracks = [];
    const first = usable[0];
    if (first?.id && first?.format) {
      try {
        const capParams = new URLSearchParams({
          format: first.format,
          id: first.id,
          detailPath: playback.detailPath,
        });
        if (playback.subjectId) capParams.set("subjectId", playback.subjectId);
        const capData = await getJson<any>({
          url: apiUrl(
            baseUrl,
            `/wefeed-h5api-bff/subject/caption?${capParams}`,
          ),
          providerContext,
          signal,
          referer,
        });
        subtitles = mapCaptions(capData?.captions || []);
      } catch (err) {
        console.log("movieBoxOnline: captions unavailable:", err);
      }
    }

    const streams: Stream[] = usable.map((source) => ({
      server: `MovieBox ${source.resolutions || source.format || ""}`.trim(),
      link: source.url || "",
      type: getStreamType(source.format, source.url),
      quality: getQuality(source.resolutions),
      subtitles,
      // Media is served from the aoneroom CDN; it validates the site origin.
      headers: { Referer: baseUrl + "/", Origin: baseUrl },
    }));

    const rank = (s: Stream) => Number(s.quality || 0);
    if (isDownload) {
      // Progressive mp4 downloads more reliably than adaptive manifests.
      streams.sort((a, b) => {
        const d = (b.type === "mp4" ? 1 : 0) - (a.type === "mp4" ? 1 : 0);
        return d !== 0 ? d : rank(b) - rank(a);
      });
    } else {
      streams.sort((a, b) => rank(b) - rank(a));
    }

    return streams;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getStream", err);
  }
};
