import { EpisodeLink, ProviderContext } from "../types";
import {
  SECTIONS,
  decodeToken,
  encodeToken,
  fetchApi,
  nowSeconds,
} from "./client";

interface RawEpisode {
  id?: string;
  t?: string;
  s?: string;
  ep?: string;
  ep_desc?: string;
  time?: string;
}

interface EpisodesData {
  episodes?: (RawEpisode | null)[];
  nextPageShow?: number;
  nextPage?: number;
}

function toNumber(value?: string): number {
  const parsed = parseInt(String(value || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
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
    const section = SECTIONS[token.ott];
    const seriesId = token.seriesId || token.id;

    const episodes: EpisodeLink[] = [];
    const seen = new Set<string>();
    let page = 1;

    // episodes.php paginates; keep going while it advertises another page.
    while (page <= 20) {
      const data = await fetchApi<EpisodesData>({
        path:
          `${section.prefix}/episodes.php?s=${encodeURIComponent(token.id)}` +
          `&series=${encodeURIComponent(seriesId)}` +
          `&t=${nowSeconds()}&page=${page}`,
        ott: token.ott,
        providerContext,
      });

      const batch = (data?.episodes || []).filter(
        (e): e is RawEpisode => Boolean(e && e.id),
      );
      if (!batch.length) break;

      for (const episode of batch) {
        const id = episode.id || "";
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const epNum = toNumber(episode.ep) || episodes.length + 1;
        const seasonNum = toNumber(episode.s) || token.season || 1;

        episodes.push({
          title: episode.t
            ? `Episode ${epNum}: ${episode.t}`
            : `Episode ${epNum}`,
          link: encodeToken({
            ott: token.ott,
            id,
            type: "series",
            title: token.title,
            year: token.year,
            season: seasonNum,
            episode: epNum,
            seriesId,
          }),
          description: episode.ep_desc || undefined,
          image: section.episodePoster(id),
        });
      }

      if (!data?.nextPageShow) break;
      page += 1;
    }

    return episodes.sort((a, b) => {
      const parse = (value: string) =>
        parseInt((/Episode (\d+)/.exec(value) || [])[1] || "0", 10);
      return parse(a.title) - parse(b.title);
    });
  } catch (err) {
    console.error("net77 getEpisodes error:", err);
    return [];
  }
};
