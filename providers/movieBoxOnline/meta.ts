import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { PROVIDER_NAME, detailUrl, fullImage, getBaseUrl, getHtml } from "./client";
import { parseNuxtDetail } from "./nuxt";

/** Playback descriptor encoded into each link and decoded by stream.ts. */
export type Playback = {
  subjectId: string;
  detailPath: string;
  season?: number;
  episode?: number;
};

export function encodePlayback(value: Playback): string {
  return JSON.stringify(value);
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const baseUrl = await getBaseUrl(providerContext);
    // posts.ts hands us a bare detailPath; tolerate a full URL too.
    const detailPath = link
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/(movies|moviesDetail)\//, "")
      .replace(/^\/+/, "")
      .split(/[?#]/)[0];

    const pageUrl = detailUrl(baseUrl, detailPath);
    const html = await getHtml({
      url: pageUrl,
      providerContext,
      referer: baseUrl + "/",
    });

    const detail = parseNuxtDetail(html, providerContext.cheerio);
    const subject = detail?.subject;
    if (!subject) {
      throw new Error(`could not read details for ${detailPath}`);
    }

    const subjectId = subject.subjectId || "";
    const isSeries = subject.subjectType === 2;
    const seasons = detail?.resource?.seasons || [];

    const linkList: Link[] = [];

    if (isSeries && seasons.length) {
      for (const season of seasons) {
        const se = season.se ?? 1;
        const maxEp = season.maxEp ?? 0;
        if (!maxEp) continue;

        const directLinks = [];
        for (let ep = 1; ep <= maxEp; ep++) {
          directLinks.push({
            title: `Episode ${ep}`,
            link: encodePlayback({ subjectId, detailPath, season: se, episode: ep }),
            type: "series" as const,
          });
        }
        linkList.push({ title: `Season ${se}`, directLinks });
      }
    } else {
      linkList.push({
        title: "Movie",
        directLinks: [
          {
            title: "Movie",
            link: encodePlayback({ subjectId, detailPath }),
            type: "movie" as const,
          },
        ],
      });
    }

    const tags = (subject.genre || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const cast = (subject.stars || [])
      .map((s) => s?.name || "")
      .filter(Boolean)
      .slice(0, 12);

    return {
      title: subject.title || detailPath,
      synopsis: subject.description || "",
      image: fullImage(subject.cover?.url),
      poster: fullImage(subject.cover?.url),
      imdbId: "",
      type: isSeries ? "series" : "movie",
      tags,
      cast,
      rating: subject.imdbRatingValue || undefined,
      linkList,
      webUrl: pageUrl,
    };
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getMeta", err);
  }
};
