import { ProviderContext, Stream, TextTracks } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  Playback,
  VIDEASY_API,
  VIDEASY_ORIGIN,
  VIDFAST_ORIGIN,
  decodeToken,
  doubleEncode,
  getEncDecApi,
  getTmdb,
  isSourceEnabled,
  isVerifyEnabled,
  parseMaybeJson,
  playbackHeaders,
  qualityFromHeight,
  qualityFromText,
  videasyHeaders,
  vidfastHeaders,
} from "./client";

/* ------------------------------------------------------------------ *
 * shared helpers                                                      *
 * ------------------------------------------------------------------ */

interface RawSource {
  url?: string;
  file?: string;
  src?: string;
  quality?: string | number;
  label?: string;
  type?: string;
}

interface RawSubtitle {
  url?: string;
  file?: string;
  src?: string;
  lang?: string;
  language?: string;
  label?: string;
  name?: string;
}

function mapSubtitles(list: RawSubtitle[] | undefined): TextTracks {
  return (list || [])
    .map((item) => {
      const uri = item?.url || item?.file || item?.src || "";
      if (!uri || !/^https?:\/\//i.test(uri)) return null;
      const label =
        item.language || item.lang || item.label || item.name || "Subtitle";
      return {
        title: String(label),
        language: String(label).slice(0, 2).toLowerCase() || "und",
        type: /\.srt(\?|$)/i.test(uri)
          ? ("application/x-subrip" as const)
          : ("text/vtt" as const),
        uri,
      };
    })
    .filter(Boolean) as TextTracks;
}

function streamType(url: string, hint?: string): string {
  const clean = (url || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8") || /hls/i.test(hint || "")) return "m3u8";
  if (clean.endsWith(".mpd")) return "mpd";
  if (clean.endsWith(".mp4")) return "mp4";
  return /\.m3u8/i.test(url) ? "m3u8" : "mp4";
}

/**
 * Confirms a link actually serves media before it is handed to the player.
 *
 * "Returns a URL" is not success: these aggregators routinely emit manifests
 * that 404, expire, or resolve to a short "content unavailable" filler. For
 * HLS we require a real `#EXTM3U`; for progressive files a ranged request must
 * come back 200/206 with a media content-type.
 */
async function verifyPlayable({
  stream,
  providerContext,
  signal,
}: {
  stream: Stream;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<boolean> {
  const { axios } = providerContext;
  try {
    if (stream.type === "m3u8") {
      const res = await axios.get(stream.link, {
        headers: stream.headers,
        signal,
        timeout: 12000,
        validateStatus: (status: number) => status < 500,
      });
      if (res.status >= 400) return false;
      const body: string = typeof res.data === "string" ? res.data : "";
      if (!body.includes("#EXTM3U")) return false;

      // A master with no variants and no segments is an empty shell.
      const hasVariants = /#EXT-X-STREAM-INF/i.test(body);
      const hasSegments = /#EXTINF/i.test(body);
      return hasVariants || hasSegments;
    }

    const res = await axios.get(stream.link, {
      headers: { ...stream.headers, Range: "bytes=0-1023" },
      signal,
      timeout: 12000,
      responseType: "arraybuffer",
      validateStatus: (status: number) => status < 500,
    });
    if (res.status >= 400) return false;
    const contentType = String(
      res.headers?.["content-type"] || res.headers?.["Content-Type"] || "",
    ).toLowerCase();
    // An HTML body here means an error/interstitial page, not a video.
    if (contentType.includes("text/html")) return false;
    return true;
  } catch (err) {
    console.log(`redflix: could not verify ${stream.server}:`, err);
    return false;
  }
}

/** POSTs an encrypted blob to the enc-dec helper and returns `result`. */
async function decrypt({
  endpoint,
  body,
  providerContext,
  signal,
}: {
  endpoint: string;
  body: Record<string, unknown>;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<any> {
  const { axios } = providerContext;
  const api = await getEncDecApi(providerContext);
  const res = await axios.post(`${api}/${endpoint}`, body, {
    headers: { "Content-Type": "application/json" },
    signal,
    timeout: 15000,
    validateStatus: (status: number) => status < 500,
  });
  const payload = parseMaybeJson(res.data);
  if (!payload || payload.status !== 200) {
    throw new Error(
      `${endpoint} failed: ${payload?.error || `status ${payload?.status ?? res.status}`}`,
    );
  }
  return payload.result;
}

/* ------------------------------------------------------------------ *
 * Videasy                                                             *
 * ------------------------------------------------------------------ */

interface VideasyServer {
  name: string;
  path: string;
  audio: string;
  language?: string;
  /** Only keep sources whose `quality` matches (that field doubles as audio). */
  qualityFilter?: string;
}

/**
 * Server list as published by the EncDecEndpoints project. Each `path` is a
 * distinct upstream scraper behind the same API.
 */
const VIDEASY_SERVERS: VideasyServer[] = [
  { name: "Yoru", path: "cdn", audio: "Original" },
  { name: "Breach", path: "m4uhd", audio: "Original" },
  { name: "Neon", path: "vsrc", audio: "Original" },
  { name: "Vyse", path: "hdmovie", audio: "Original", qualityFilter: "English" },
  { name: "Fade", path: "hdmovie", audio: "Hindi", qualityFilter: "Hindi" },
  { name: "Killjoy", path: "meine", audio: "German", language: "german" },
  { name: "Omen", path: "lamovie", audio: "Spanish" },
  { name: "Raze", path: "superflix", audio: "Portuguese" },
];

async function videasyStreams({
  token,
  providerContext,
  signal,
}: {
  token: Playback;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Stream[]> {
  const { axios } = providerContext;
  const isTv = token.type === "tv";

  // The seed is IP-bound and expires after ~30s, so it must be fetched
  // immediately before the source requests that consume it.
  const seedRes = await axios.get(
    `${VIDEASY_API}/seed?mediaId=${encodeURIComponent(token.tmdbId)}`,
    { headers: videasyHeaders, signal, timeout: 12000 },
  );
  const seed = parseMaybeJson(seedRes.data)?.seed;
  if (!seed) return [];

  const title = token.title || "";
  const year = (token.year || "").slice(0, 4);
  const season = token.season || 1;
  const episode = token.episode || 1;

  const collected: Stream[] = [];

  const tasks = VIDEASY_SERVERS.map(async (server) => {
    try {
      let url =
        `${VIDEASY_API}/${server.path}/sources-with-title` +
        `?title=${doubleEncode(title)}` +
        `&mediaType=${isTv ? "tv" : "movie"}` +
        `&year=${encodeURIComponent(year)}` +
        `&episodeId=${episode}&seasonId=${season}` +
        `&tmdbId=${encodeURIComponent(token.tmdbId)}` +
        `&enc=2&seed=${encodeURIComponent(seed)}`;
      if (token.imdbId) url += `&imdbId=${encodeURIComponent(token.imdbId)}`;
      if (server.language) url += `&language=${server.language}`;

      const res = await axios.get(url, {
        headers: videasyHeaders,
        signal,
        timeout: 15000,
        validateStatus: (status: number) => status < 500,
      });

      const encText =
        typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      if (!encText || encText.length < 10) return;
      // The backend reports seed problems as plain JSON rather than ciphertext.
      if (/STREAMCRYPTO_SEED_INVALID|"error"/.test(encText)) return;

      const result = await decrypt({
        endpoint: "dec-videasy",
        body: { text: encText, id: String(token.tmdbId), seed },
        providerContext,
        signal,
      });

      const subtitles = mapSubtitles(result?.subtitles);
      const headers = playbackHeaders(VIDEASY_ORIGIN);

      let sources: RawSource[] = result?.sources || [];
      if (server.qualityFilter) {
        sources = sources.filter(
          (s) =>
            String(s?.quality || "").toLowerCase() ===
            server.qualityFilter!.toLowerCase(),
        );
      }

      for (const source of sources) {
        const link = source?.url || source?.file || source?.src || "";
        if (!link || !/^https?:\/\//i.test(link)) continue;
        collected.push({
          server: `${server.name} (${server.audio})`,
          link,
          type: streamType(link, source.type),
          // For these servers `quality` carries an audio language on some
          // paths, so only trust it when it looks like a resolution.
          quality: qualityFromText(source.quality),
          subtitles: subtitles.length ? subtitles : undefined,
          headers,
        });
      }

      if (!sources.length && typeof result?.url === "string") {
        collected.push({
          server: `${server.name} (${server.audio})`,
          link: result.url,
          type: streamType(result.url),
          subtitles: subtitles.length ? subtitles : undefined,
          headers,
        });
      }
    } catch (err) {
      console.log(`redflix: Videasy ${server.name} failed:`, err);
    }
  });

  await Promise.all(tasks.map((t) => t.catch(() => undefined)));
  return collected;
}

/* ------------------------------------------------------------------ *
 * VidFast                                                             *
 * ------------------------------------------------------------------ */

/**
 * VidFast flow (as documented by EncDecEndpoints):
 *   1. GET the player page, scrape the inline `"en"`/`"token"` blob.
 *   2. enc-vidfast(blob) -> { servers, stream, token }.
 *   3. POST `servers` with X-CSRF-Token -> encrypted server list -> decrypt.
 *   4. POST `stream/{data}` per server -> encrypted stream -> decrypt.
 */
async function vidfastStreams({
  token,
  providerContext,
  signal,
}: {
  token: Playback;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Stream[]> {
  const { axios } = providerContext;
  const api = await getEncDecApi(providerContext);
  const isTv = token.type === "tv";

  const pageUrl = isTv
    ? `${VIDFAST_ORIGIN}/tv/${token.tmdbId}/${token.season || 1}/${token.episode || 1}/`
    : `${VIDFAST_ORIGIN}/movie/${token.tmdbId}/`;

  const pageRes = await axios.get(pageUrl, {
    headers: vidfastHeaders(),
    signal,
    timeout: 15000,
    validateStatus: (status: number) => status < 500,
  });
  const html: string = typeof pageRes.data === "string" ? pageRes.data : "";
  if (!html) return [];

  const blob = (/\\"(?:en|token)\\":\\"(.*?)\\"/.exec(html) ||
    /"(?:en|token)":"(.*?)"/.exec(html) ||
    [])[1];
  if (!blob) return [];

  const encRes = await axios.get(
    `${api}/enc-vidfast?text=${encodeURIComponent(blob)}`,
    { headers: vidfastHeaders(), signal, timeout: 15000 },
  );
  const encPayload = parseMaybeJson(encRes.data);
  if (!encPayload || encPayload.status !== 200) return [];

  const serversUrl: string = encPayload.result?.servers || "";
  const streamBase: string = encPayload.result?.stream || "";
  const csrf: string = encPayload.result?.token || "";
  if (!serversUrl || !streamBase) return [];

  const serversRes = await axios.post(serversUrl, null, {
    headers: vidfastHeaders(csrf),
    signal,
    timeout: 15000,
    validateStatus: (status: number) => status < 500,
  });
  const serversText =
    typeof serversRes.data === "string"
      ? serversRes.data
      : JSON.stringify(serversRes.data);
  if (!serversText || serversText.length < 10) return [];

  const serverList = await decrypt({
    endpoint: "dec-vidfast",
    body: { text: serversText },
    providerContext,
    signal,
  });
  if (!Array.isArray(serverList) || !serverList.length) return [];

  const headers = playbackHeaders(VIDFAST_ORIGIN);
  const collected: Stream[] = [];

  // A handful of servers is plenty; each costs two round-trips.
  const tasks = serverList.slice(0, 6).map(async (entry: any, index: number) => {
    const data = entry?.data;
    if (!data) return;
    const label = entry?.name || entry?.label || `Server ${index + 1}`;
    try {
      const streamRes = await axios.post(`${streamBase}/${data}`, null, {
        headers: vidfastHeaders(csrf),
        signal,
        timeout: 15000,
        validateStatus: (status: number) => status < 500,
      });
      const streamText =
        typeof streamRes.data === "string"
          ? streamRes.data
          : JSON.stringify(streamRes.data);
      if (!streamText || streamText.length < 10) return;

      const result = await decrypt({
        endpoint: "dec-vidfast",
        body: { text: streamText },
        providerContext,
        signal,
      });

      const subtitles = mapSubtitles(
        result?.subtitles || result?.tracks || result?.captions,
      );

      const candidates: RawSource[] = Array.isArray(result?.sources)
        ? result.sources
        : result?.url || result?.file
          ? [{ url: result.url || result.file }]
          : [];

      for (const source of candidates) {
        const link = source?.url || source?.file || source?.src || "";
        if (!link || !/^https?:\/\//i.test(link)) continue;
        collected.push({
          server: `VidFast ${label}`,
          link,
          type: streamType(link, source.type),
          quality: qualityFromText(source.quality || source.label),
          subtitles: subtitles.length ? subtitles : undefined,
          headers,
        });
      }
    } catch (err) {
      console.log(`redflix: VidFast ${label} failed:`, err);
    }
  });

  await Promise.all(tasks.map((t) => t.catch(() => undefined)));
  return collected;
}

/* ------------------------------------------------------------------ *
 * episode identity                                                    *
 * ------------------------------------------------------------------ */

/**
 * Fills in title/year/imdbId when the caller only had a bare id.
 *
 * Videasy matches on title+year, so a missing title silently returns either
 * nothing or - worse - a same-named different title.
 */
async function hydrate({
  token,
  providerContext,
  signal,
}: {
  token: Playback;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Playback> {
  if (token.title && token.year && token.imdbId) return token;
  try {
    const detail = await getTmdb<any>({
      path:
        `/${token.type === "tv" ? "tv" : "movie"}/${token.tmdbId}` +
        `?append_to_response=external_ids`,
      providerContext,
      signal,
    });
    return {
      ...token,
      title: token.title || detail?.title || detail?.name || "",
      year:
        token.year ||
        String(detail?.release_date || detail?.first_air_date || "").slice(0, 4),
      imdbId:
        token.imdbId || detail?.external_ids?.imdb_id || detail?.imdb_id || "",
    };
  } catch (err) {
    console.log("redflix: could not hydrate title metadata:", err);
    return token;
  }
}

/**
 * Confirms the requested episode exists before asking any embed provider.
 *
 * Aggregators commonly fall back to S1E1 (or the series pilot) when an episode
 * is unknown, which plays the wrong thing while reporting success. TMDB is the
 * authority on whether the episode exists at all.
 */
async function episodeExists({
  token,
  providerContext,
  signal,
}: {
  token: Playback;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (token.type !== "tv") return true;
  const season = token.season ?? 1;
  const episode = token.episode ?? 1;
  try {
    const data = await getTmdb<any>({
      path: `/tv/${token.tmdbId}/season/${season}/episode/${episode}`,
      providerContext,
      signal,
    });
    if (!data || data.success === false) return false;
    // The endpoint echoes what it resolved - make sure it is what we asked for.
    if (
      typeof data.episode_number === "number" &&
      data.episode_number !== episode
    ) {
      return false;
    }
    if (
      typeof data.season_number === "number" &&
      data.season_number !== season
    ) {
      return false;
    }
    return true;
  } catch (err) {
    // A 404 here means the episode genuinely does not exist.
    console.log(
      `redflix: TMDB has no S${season}E${episode} for ${token.tmdbId}:`,
      err,
    );
    return false;
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
    let token = decodeToken(link);
    if (!token.tmdbId) throw new Error(`unrecognised stream link: ${link}`);

    // `type` from the app wins when the token predates typed links.
    if (type === "series" && token.type !== "tv") token.type = "tv";

    if (token.type === "tv" && !(await episodeExists({ token, providerContext, signal }))) {
      throw new Error(
        `season ${token.season ?? 1} episode ${token.episode ?? 1} does not exist for this title`,
      );
    }

    token = await hydrate({ token, providerContext, signal });

    const [useVideasy, useVidfast] = await Promise.all([
      isSourceEnabled(providerContext, "redflixUseVideasy"),
      isSourceEnabled(providerContext, "redflixUseVidfast"),
    ]);

    const batches = await Promise.all([
      useVideasy
        ? videasyStreams({ token, providerContext, signal }).catch((err) => {
            console.log("redflix: Videasy unavailable:", err);
            return [] as Stream[];
          })
        : Promise.resolve([] as Stream[]),
      useVidfast
        ? vidfastStreams({ token, providerContext, signal }).catch((err) => {
            console.log("redflix: VidFast unavailable:", err);
            return [] as Stream[];
          })
        : Promise.resolve([] as Stream[]),
    ]);

    let streams: Stream[] = [];
    const seen = new Set<string>();
    for (const batch of batches) {
      for (const stream of batch) {
        if (!stream.link || seen.has(stream.link)) continue;
        seen.add(stream.link);
        streams.push(stream);
      }
    }

    if (!streams.length) {
      throw new Error(
        "no playable source found for this title - the embed providers " +
          "returned nothing, which usually means it is not in their library yet",
      );
    }

    // Drop anything that does not actually serve media, so the player is
    // never handed a link that resolves but plays nothing.
    if (await isVerifyEnabled(providerContext)) {
      const verdicts = await Promise.all(
        streams.map((stream) =>
          verifyPlayable({ stream, providerContext, signal }),
        ),
      );
      const playable = streams.filter((_, index) => verdicts[index]);
      if (playable.length) {
        streams = playable;
      } else {
        throw new Error(
          "every source for this title failed verification (dead or expired " +
            "links) - try again shortly or switch sources in provider settings",
        );
      }
    }

    const rank = (s: Stream) => Number(s.quality || 0);

    if (isDownload) {
      // Progressive files download far more reliably than segmented HLS.
      streams.sort((a, b) => {
        const d = (b.type === "mp4" ? 1 : 0) - (a.type === "mp4" ? 1 : 0);
        return d !== 0 ? d : rank(b) - rank(a);
      });
    } else {
      // For playback prefer adaptive HLS, then the highest fixed quality.
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
