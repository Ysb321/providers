import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  OttCode,
  PROVIDER_NAME,
  SECTIONS,
  decodeToken,
  encodeToken,
  fetchApi,
  getBaseUrl,
  nowSeconds,
  resolveTmdbIds,
} from "./client";

interface RawEpisode {
  id?: string;
  t?: string;
  s?: string;
  ep?: string;
  ep_desc?: string;
  time?: string;
}

interface RawSeason {
  s?: string;
  id?: string;
  ep?: string;
}

interface PostData {
  status?: string;
  error?: string | null;
  title?: string;
  year?: string;
  desc?: string;
  cast?: string;
  short_cast?: string;
  genre?: string;
  match?: string;
  type?: string;
  runtime?: string;
  season?: RawSeason[];
  episodes?: (RawEpisode | null)[];
  nextPageShow?: number;
  nextPageSeason?: string;
}

function splitList(value?: string): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function seasonNumber(value?: string): number {
  const parsed = parseInt(String(value || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const token = decodeToken(link);
    const ott: OttCode = token.ott;
    const section = SECTIONS[ott];
    const baseUrl = await getBaseUrl(providerContext);

    const data = await fetchApi<PostData>({
      path: `${section.prefix}/post.php?id=${encodeURIComponent(
        token.id,
      )}&t=${nowSeconds()}`,
      ott,
      providerContext,
    });

    if (data?.error && !data.title) {
      throw new Error(String(data.error));
    }

    const title = data?.title || token.title || "";
    const year = data?.year || token.year || "";
    const seasons = (data?.season || []).filter((s) => s?.id);
    const inlineEpisodes = (data?.episodes || []).filter(
      (e): e is RawEpisode => Boolean(e && e.id),
    );

    // `type` is "m" (movie) / "t" (tv). Fall back to the episode payload.
    const isSeries =
      data?.type === "t" || seasons.length > 0 || inlineEpisodes.length > 0;

    const linkList: Link[] = [];

    if (isSeries) {
      if (seasons.length) {
        // Each season needs its own request, so hand Vega an episodesLink and
        // let episodes.ts expand it lazily.
        for (const season of seasons) {
          const num = seasonNumber(season.s) || linkList.length + 1;
          linkList.push({
            title: `Season ${num}`,
            episodesLink: encodeToken({
              ott,
              id: season.id || "",
              type: "series",
              title,
              year,
              season: num,
              seriesId: token.id,
            }),
          });
        }
      } else if (inlineEpisodes.length) {
        // Single-season show: post.php already carries every episode.
        const num = seasonNumber(inlineEpisodes[0]?.s) || 1;
        linkList.push({
          title: `Season ${num}`,
          directLinks: inlineEpisodes.map((episode, index) => {
            const epNum =
              seasonNumber(episode.ep) || index + 1;
            return {
              title: episode.t
                ? `Episode ${epNum}: ${episode.t}`
                : `Episode ${epNum}`,
              link: encodeToken({
                ott,
                id: episode.id || "",
                type: "series",
                title,
                year,
                season: num,
                episode: epNum,
                seriesId: token.id,
              }),
              type: "series" as const,
              description: episode.ep_desc || undefined,
              image: episode.id
                ? section.episodePoster(episode.id)
                : undefined,
            };
          }),
        });
      }
    }

    if (!linkList.length) {
      linkList.push({
        title: "Movie",
        directLinks: [
          {
            title: "Movie",
            link: encodeToken({
              ott,
              id: token.id,
              type: "movie",
              title,
              year,
            }),
            type: "movie" as const,
          },
        ],
      });
    }

    const tags = splitList(data?.genre);
    if (year) tags.unshift(year);

    // The site never exposes an IMDb id, but the app uses one to enrich the
    // entry from Cinemeta. Resolve it from the title (cached, best-effort).
    let imdbId = "";
    let tmdbId = "";
    if (title) {
      try {
        const ids = await resolveTmdbIds({
          title,
          year,
          isSeries,
          providerContext,
        });
        imdbId = ids.imdbId;
        tmdbId = ids.tmdbId;
      } catch {
        /* enrichment is optional */
      }
    }

    return {
      title,
      synopsis: data?.desc || "",
      image: section.poster(token.id),
      poster: section.poster(token.id),
      imdbId,
      tmdbId: tmdbId || undefined,
      type: isSeries ? "series" : "movie",
      tags,
      cast: splitList(data?.cast || data?.short_cast).slice(0, 12),
      // `match` looks like "IMDb 8" - keep just the number.
      rating: (data?.match || "").replace(/[^0-9.]/g, "") || undefined,
      linkList,
      webUrl: `${baseUrl}${section.prefix}/post.php?id=${token.id}`,
    };
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getMeta", err);
  }
};
