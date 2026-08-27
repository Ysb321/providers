import { EpisodeLink, ProviderContext } from "../types";
import {
  decodeToken,
  encodeToken,
  getTmdb,
  posterUrl,
} from "./client";

interface TmdbEpisode {
  episode_number?: number;
  season_number?: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string;
}

export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  try {
    const token = decodeToken(url);
    const season = token.season ?? 1;

    const data = await getTmdb<{ episodes?: TmdbEpisode[] }>({
      path: `/tv/${token.tmdbId}/season/${season}`,
      providerContext,
    });

    const episodes: EpisodeLink[] = [];
    const seen = new Set<number>();

    for (const episode of data?.episodes || []) {
      const num = episode?.episode_number;
      if (typeof num !== "number" || seen.has(num)) continue;

      // Unaired episodes have no playable source anywhere.
      if (episode.air_date) {
        const aired = Date.parse(episode.air_date);
        if (Number.isFinite(aired) && aired > Date.now()) continue;
      }

      seen.add(num);
      episodes.push({
        title: episode.name
          ? `Episode ${num}: ${episode.name}`
          : `Episode ${num}`,
        link: encodeToken({
          tmdbId: token.tmdbId,
          type: "tv",
          title: token.title,
          year: token.year,
          imdbId: token.imdbId,
          season: episode.season_number ?? season,
          episode: num,
        }),
        description: episode.overview || undefined,
        image: posterUrl(episode.still_path, "w300"),
      });
    }

    return episodes.sort((a, b) => {
      const parse = (value: string) =>
        parseInt((/Episode (\d+)/.exec(value) || [])[1] || "0", 10);
      return parse(a.title) - parse(b.title);
    });
  } catch (err) {
    console.error("redflix getEpisodes error:", err);
    return [];
  }
};
