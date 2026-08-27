import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  decodeToken,
  encodeToken,
  getBaseUrl,
  getTmdb,
  posterUrl,
  titleOf,
  yearOf,
} from "./client";

interface TmdbSeason {
  season_number?: number;
  episode_count?: number;
  name?: string;
}

interface TmdbDetail {
  id?: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genres?: { name?: string }[];
  seasons?: TmdbSeason[];
  imdb_id?: string;
  external_ids?: { imdb_id?: string };
  credits?: { cast?: { name?: string }[] };
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
    if (!token.tmdbId) throw new Error(`unrecognised link: ${link}`);

    const isTv = token.type === "tv";
    const baseUrl = await getBaseUrl(providerContext);

    const detail = await getTmdb<TmdbDetail>({
      path:
        `/${isTv ? "tv" : "movie"}/${token.tmdbId}` +
        `?append_to_response=external_ids,credits`,
      providerContext,
    });

    const title = titleOf(detail) || token.title || "";
    const year = yearOf(detail) || token.year || "";
    const imdbId = detail?.external_ids?.imdb_id || detail?.imdb_id || "";

    const linkList: Link[] = [];

    if (isTv) {
      // Season 0 is "Specials" - keep it only when it actually has episodes.
      const seasons = (detail?.seasons || []).filter(
        (s) =>
          typeof s.season_number === "number" &&
          (s.episode_count || 0) > 0 &&
          s.season_number >= 0,
      );

      for (const season of seasons) {
        const num = season.season_number as number;
        linkList.push({
          title:
            num === 0 ? "Specials" : season.name || `Season ${num}`,
          // Episodes need their own TMDB request, so defer to episodes.ts.
          episodesLink: encodeToken({
            tmdbId: token.tmdbId,
            type: "tv",
            title,
            year,
            imdbId,
            season: num,
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
              tmdbId: token.tmdbId,
              type: isTv ? "tv" : "movie",
              title,
              year,
              imdbId,
              ...(isTv ? { season: 1, episode: 1 } : {}),
            }),
            type: isTv ? ("series" as const) : ("movie" as const),
          },
        ],
      });
    }

    const tags = (detail?.genres || [])
      .map((g) => g?.name || "")
      .filter(Boolean);
    if (year) tags.unshift(year);

    const cast = (detail?.credits?.cast || [])
      .map((c) => c?.name || "")
      .filter(Boolean)
      .slice(0, 12);

    const rating =
      typeof detail?.vote_average === "number" && detail.vote_average > 0
        ? detail.vote_average.toFixed(1)
        : undefined;

    return {
      title,
      synopsis: detail?.overview || "",
      image: posterUrl(detail?.poster_path, "w500"),
      poster: posterUrl(detail?.backdrop_path || detail?.poster_path, "w780"),
      imdbId,
      tmdbId: token.tmdbId,
      type: isTv ? "series" : "movie",
      tags,
      cast,
      rating,
      linkList,
      webUrl: `${baseUrl}/play?id=${token.tmdbId}&type=${isTv ? "tv" : "movie"}`,
    };
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getMeta", err);
  }
};
