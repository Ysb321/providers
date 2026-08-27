import { ProviderContext, Stream, TextTracks } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  OttCode,
  PLACEHOLDER_ID,
  PROVIDER_NAME,
  Playback,
  SECTIONS,
  TMDB_API_BASE,
  TMDB_API_REFERER,
  ajaxHeaders,
  cookieHeader,
  decodeToken,
  fetchApi,
  getBaseUrl,
  getGuestCookie,
  resolveTmdbIds,
  isFallbackEnabled,
  newTvHeaders,
  nowSeconds,
  playbackHeaders,
  qualityFromHeight,
  qualityFromLabel,
  resolveNewTvBase,
} from "./client";

/* ------------------------------------------------------------------ *
 * native playlist.php                                                 *
 * ------------------------------------------------------------------ */

interface PlaylistSource {
  file?: string;
  label?: string;
  type?: string;
}

interface PlaylistTrack {
  kind?: string;
  file?: string;
  label?: string;
  language?: string;
}

interface PlaylistItem {
  title?: string;
  sources?: PlaylistSource[];
  tracks?: PlaylistTrack[];
}

function absolutise(file: string, baseUrl: string): string {
  if (!file) return "";
  if (file.startsWith("//")) return "https:" + file;
  if (/^https?:\/\//i.test(file)) return file;
  return `${baseUrl.replace(/\/+$/, "")}${file.startsWith("/") ? "" : "/"}${file}`;
}

function mapTracks(tracks: PlaylistTrack[], baseUrl: string): TextTracks {
  return tracks
    .filter(
      (t) =>
        t?.file &&
        (t.kind === "captions" || t.kind === "subtitles" || !t.kind),
    )
    .map((t) => {
      const uri = absolutise(t.file || "", baseUrl);
      const lower = uri.toLowerCase();
      return {
        title: t.label || t.language || "Subtitle",
        language: t.language || t.label || "und",
        type: lower.includes(".vtt")
          ? ("text/vtt" as const)
          : ("application/x-subrip" as const),
        uri,
      };
    })
    .filter((t) => Boolean(t.uri));
}

/**
 * Reads a master playlist and reports whether its *video* renditions are the
 * shared guest placeholder.
 *
 * NetMirror serves anonymous clients a manifest whose audio tracks are the
 * real title but whose video variants all live under `/files/220884/` - a ten
 * minute "sign in to continue" reel. Handing that to the player is the
 * difference between a link that resolves and a link that actually plays the
 * movie, so every native master is verified before it is offered.
 */
async function inspectMaster({
  url,
  headers,
  providerContext,
  signal,
}: {
  url: string;
  headers: Record<string, string>;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<{ verdict: "real" | "placeholder" | "unknown"; body: string }> {
  const { axios } = providerContext;
  try {
    const res = await axios.get(url, {
      headers,
      signal,
      timeout: 12000,
      validateStatus: (status: number) => status < 500,
    });
    const body: string = typeof res.data === "string" ? res.data : "";
    if (!body || !body.includes("#EXTM3U")) {
      return { verdict: "unknown", body: "" };
    }

    // Only the video variant lines matter - audio/subtitle URIs legitimately
    // carry the real content id even on a placeholder manifest.
    const variants = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    if (!variants.length) return { verdict: "unknown", body };

    const placeholder = variants.every(
      (line) =>
        line.includes(`/files/${PLACEHOLDER_ID}/`) || /in=unknown/.test(line),
    );
    return { verdict: placeholder ? "placeholder" : "real", body };
  } catch (err) {
    console.log("net77: could not verify master playlist:", err);
    return { verdict: "unknown", body: "" };
  }
}

async function nativeStreams({
  token,
  providerContext,
  signal,
}: {
  token: Playback;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<{ streams: Stream[]; placeholder: boolean }> {
  const ott: OttCode = token.ott;
  const section = SECTIONS[ott];
  const baseUrl = await getBaseUrl(providerContext);

  const payload = await fetchApi<PlaylistItem[] | PlaylistItem>({
    path: `${section.prefix}/playlist.php?id=${encodeURIComponent(
      token.id,
    )}&t=${nowSeconds()}`,
    ott,
    providerContext,
    signal,
  });

  const item: PlaylistItem | undefined = Array.isArray(payload)
    ? payload[0]
    : payload;
  const sources = (item?.sources || []).filter((s) => s?.file);
  if (!sources.length) return { streams: [], placeholder: false };

  const subtitles = mapTracks(item?.tracks || [], baseUrl);
  const headers = playbackHeaders(baseUrl);
  const guestToken = await getGuestCookie({ providerContext, baseUrl, signal });
  const withCookie = {
    ...headers,
    Cookie: cookieHeader(guestToken, ott),
  };

  // One probe is enough: every entry is the same manifest with a different
  // `q=` hint, so they share a verdict.
  const probe = await inspectMaster({
    url: absolutise(sources[0].file || "", baseUrl),
    headers: withCookie,
    providerContext,
    signal,
  });

  if (probe.verdict === "placeholder") {
    console.log(
      `net77: ${section.label} returned the guest placeholder for ${token.id} - skipping native sources`,
    );
    return { streams: [], placeholder: true };
  }

  const streams: Stream[] = sources.map((source) => ({
    server: `${section.label} ${source.label || "Auto"}`.trim(),
    link: absolutise(source.file || "", baseUrl),
    type: "m3u8",
    quality: qualityFromLabel(source.label || ""),
    subtitles,
    headers: withCookie,
  }));

  return { streams, placeholder: false };
}

/* ------------------------------------------------------------------ *
 * NewTV (official app) playlist                                       *
 * ------------------------------------------------------------------ */

async function newTvStreams({
  token,
  providerContext,
  signal,
}: {
  token: Playback;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Stream[]> {
  const { axios } = providerContext;
  const apiBase = await resolveNewTvBase({ providerContext, signal });
  if (!apiBase) return [];

  try {
    const res = await axios.get(
      `${apiBase}/newtv/player.php?id=${encodeURIComponent(token.id)}`,
      {
        headers: { ...newTvHeaders, Ott: token.ott, Usertoken: "" },
        signal,
        timeout: 12000,
      },
    );
    const payload =
      typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    const videoLink: string = payload?.video_link || "";
    if (!videoLink) return [];

    const referer: string = payload?.referer || apiBase;
    const headers = playbackHeaders(referer);

    const probe = await inspectMaster({
      url: videoLink,
      headers,
      providerContext,
      signal,
    });
    if (probe.verdict === "placeholder") {
      console.log(
        `net77: NewTV returned the guest placeholder for ${token.id} - skipping`,
      );
      return [];
    }

    const streams: Stream[] = [
      {
        server: `${SECTIONS[token.ott].label} Auto`,
        link: videoLink,
        type: "m3u8",
        headers,
      },
    ];

    // Expose each rendition too, so the user has a manual fallback if the
    // adaptive master stalls in the player.
    if (probe.body) {
      const lines = probe.body.split("\n");
      const dir = videoLink.substring(0, videoLink.lastIndexOf("/") + 1);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
        const height = parseInt(
          (/RESOLUTION=\d+x(\d+)/.exec(line) || [])[1] || "0",
          10,
        );
        const next = (lines[i + 1] || "").trim();
        if (!next || next.startsWith("#")) continue;
        const url = /^https?:\/\//i.test(next)
          ? next
          : dir + next.replace(/^\.?\//, "");
        if (url.includes(`/files/${PLACEHOLDER_ID}/`)) continue;
        streams.push({
          server: `${SECTIONS[token.ott].label} ${height ? height + "p" : "Variant"}`,
          link: url,
          type: "m3u8",
          quality: qualityFromHeight(height),
          headers,
        });
      }
    }

    return streams;
  } catch (err) {
    console.log("net77: NewTV flow failed:", err);
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * net27 TMDB fallback                                                 *
 * ------------------------------------------------------------------ */

interface TmdbEmbedResponse {
  ok?: boolean;
  mp4?: string;
  resolution?: string;
  streams?: { url?: string; resolution?: number }[];
  captions?: { lang?: string; name?: string; url?: string }[];
  currentSeason?: number;
  currentEpisode?: number;
  noSource?: boolean;
  error?: string;
}

async function fallbackStreams({
  token,
  providerContext,
  signal,
}: {
  token: Playback;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Stream[]> {
  if (!(await isFallbackEnabled(providerContext))) return [];

  const isSeries = token.type === "series" || token.season !== undefined;
  const { tmdbId } = await resolveTmdbIds({
    title: token.title || "",
    year: token.year,
    isSeries,
    providerContext,
    signal,
  });
  if (!tmdbId) return [];

  const { axios } = providerContext;
  const season = token.season || 1;
  const episode = token.episode || 1;

  /**
   * The episode selectors are `se`/`ep`. The abbreviated `s`/`e` form that
   * older write-ups use is silently ignored and always yields S1E1, so the
   * response is verified against what was asked for below.
   */
  const buildUrl = (useShortParams: boolean) => {
    if (!isSeries) return `${TMDB_API_BASE}/api/embed-tmdb/${tmdbId}`;
    return useShortParams
      ? `${TMDB_API_BASE}/api/embed-tmdb/${tmdbId}?type=tv&s=${season}&e=${episode}`
      : `${TMDB_API_BASE}/api/embed-tmdb/${tmdbId}?type=tv&se=${season}&ep=${episode}`;
  };

  const request = async (url: string): Promise<TmdbEmbedResponse | null> => {
    try {
      const res = await axios.get(url, {
        headers: {
          Accept: "application/json",
          Referer: TMDB_API_REFERER,
          "User-Agent": ajaxHeaders["User-Agent"],
        },
        signal,
        timeout: 15000,
      });
      return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    } catch (err) {
      console.log("net77: fallback request failed:", err);
      return null;
    }
  };

  try {
    let data = await request(buildUrl(false));

    if (!data?.ok || data.noSource) {
      if (data?.error) console.log(`net77: fallback unavailable: ${data.error}`);
      return [];
    }

    // Serving episode 1 when the user asked for another is worse than serving
    // nothing, so require the API to echo back the episode we requested. Retry
    // once with the legacy parameter names in case the backend rolls back.
    if (isSeries) {
      const matches = (payload: TmdbEmbedResponse | null) =>
        (payload?.currentSeason ?? 1) === season &&
        (payload?.currentEpisode ?? 1) === episode;

      if (!matches(data)) {
        const retry = await request(buildUrl(true));
        if (matches(retry) && retry?.ok && !retry.noSource) {
          data = retry;
        } else {
          console.log(
            `net77: fallback returned S${data.currentSeason ?? 1}E${
              data.currentEpisode ?? 1
            } for the requested S${season}E${episode} - discarding to avoid ` +
              `playing the wrong episode`,
          );
          return [];
        }
      }
    }

    const headers = {
      Referer: TMDB_API_REFERER,
      "User-Agent": ajaxHeaders["User-Agent"],
    };

    // Captions come back either as absolute URLs or as a site-relative
    // `/api/proxy/video?...` path - the player needs an absolute one.
    const subtitles: TextTracks = (data.captions || [])
      .filter((c) => Boolean(c?.url))
      .map((c) => {
        const raw = c.url || "";
        const uri = /^https?:\/\//i.test(raw)
          ? raw
          : `${TMDB_API_BASE}${raw.startsWith("/") ? "" : "/"}${raw}`;
        return {
          title: c.name || c.lang || "Subtitle",
          language: c.lang || "und",
          type: uri.toLowerCase().includes(".vtt")
            ? ("text/vtt" as const)
            : ("application/x-subrip" as const),
          uri,
        };
      });

    const streams: Stream[] = [];
    const seen = new Set<string>();

    for (const entry of data.streams || []) {
      if (!entry?.url || seen.has(entry.url)) continue;
      seen.add(entry.url);
      streams.push({
        server: `NetMirror ${entry.resolution || ""}p`.replace(" p", ""),
        link: entry.url,
        type: "mp4",
        quality: qualityFromHeight(Number(entry.resolution || 0)),
        subtitles,
        headers,
      });
    }

    if (!streams.length && data.mp4) {
      streams.push({
        server: "NetMirror",
        link: data.mp4,
        type: "mp4",
        quality: qualityFromHeight(parseInt(data.resolution || "0", 10)),
        subtitles,
        headers,
      });
    }

    return streams;
  } catch (err) {
    console.log("net77: fallback request failed:", err);
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * entry point                                                         *
 * ------------------------------------------------------------------ */

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
    const token = decodeToken(link);
    if (!token.id) throw new Error(`unrecognised stream link: ${link}`);

    let streams: Stream[] = [];
    let sawPlaceholder = false;

    // 1) The site's own playlist - adaptive HLS with audio tracks + subtitles.
    try {
      const native = await nativeStreams({ token, providerContext, signal });
      streams = streams.concat(native.streams);
      sawPlaceholder = native.placeholder;
    } catch (err) {
      console.log("net77: playlist.php failed:", err);
    }

    // 2) The official app's media API - a different host, so it sometimes
    //    serves a real manifest when the browser endpoint will not.
    if (!streams.length) {
      streams = streams.concat(
        await newTvStreams({ token, providerContext, signal }),
      );
    }

    // 3) Progressive MP4s keyed by TMDB id.
    if (!streams.length) {
      streams = streams.concat(
        await fallbackStreams({ token, providerContext, signal }),
      );
    }

    // De-duplicate while keeping the first (highest-confidence) entry.
    const seen = new Set<string>();
    streams = streams.filter((s) => {
      if (!s.link || seen.has(s.link)) return false;
      seen.add(s.link);
      return true;
    });

    if (!streams.length) {
      throw new Error(
        sawPlaceholder
          ? "this title is only available to signed-in NetMirror users - " +
            "the guest session returns a placeholder reel instead of the video"
          : "no playable source found for this title",
      );
    }

    const rank = (s: Stream) => Number(s.quality || 0);

    if (isDownload) {
      // Progressive MP4 downloads far more reliably than segmented HLS.
      streams.sort((a, b) => {
        const d = (b.type === "mp4" ? 1 : 0) - (a.type === "mp4" ? 1 : 0);
        return d !== 0 ? d : rank(b) - rank(a);
      });
    } else {
      // For playback the adaptive master goes first: it carries every audio
      // track and subtitle, and lets the player pick a rendition itself.
      streams.sort((a, b) => {
        const score = (s: Stream) => (s.type === "m3u8" ? 1 : 0);
        const d = score(b) - score(a);
        return d !== 0 ? d : rank(b) - rank(a);
      });
    }

    return streams;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getStream", err);
  }
};
