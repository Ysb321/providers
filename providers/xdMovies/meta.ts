import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  absoluteUrl,
  fetchPage,
  getBaseUrl,
  qualityOf,
  qualityRank,
} from "./client";

/** Hosts we can turn into a playable/downloadable file. */
const FILE_HOSTS =
  /(link\.xdmovies|hubcloud|hubdrive|vcloud|gdflix|gdlink|gofile|pixeldrain|filepress|filebee|driveleech|driveseed)/i;

type Entry = {
  label: string;
  url: string;
  season?: number;
  episode?: number;
  quality?: string;
};

function parseSeasonEpisode(text: string): { season?: number; episode?: number } {
  const se = text.match(/\bS(\d{1,2})[.\s_-]?E(\d{1,3})\b/i);
  if (se) return { season: parseInt(se[1], 10), episode: parseInt(se[2], 10) };
  const seasonOnly = text.match(/\bS(?:eason\s*)?(\d{1,2})\b/i);
  if (seasonOnly) return { season: parseInt(seasonOnly[1], 10) };
  return {};
}

/** Trims a release filename down to something readable in the UI. */
function shortLabel(filename: string, size: string): string {
  const clean = (filename || "")
    .replace(/-XDMovies\.com|\.mkv$|\.mp4$|\.zip$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = [clean];
  if (size) parts.push(`[${size}]`);
  return parts.join(" ").trim();
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const { cheerio } = providerContext;

  try {
    const baseUrl = await getBaseUrl(providerContext);
    const html = await fetchPage({
      url: link,
      providerContext,
      referer: baseUrl + "/",
    });
    const $ = cheerio.load(html || "");

    const isSeries = /\/series\//i.test(link);

    const title = (
      $("h1, h2").first().text() ||
      $("meta[property='og:title']").attr("content") ||
      ""
    )
      .replace(/\s*—\s*(Movie|Series)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    const bodyText = $("body").text().replace(/\s+/g, " ");

    const fieldOf = (label: string): string => {
      const m = bodyText.match(
        new RegExp(
          `${label}\\s*:?\\s*(.+?)\\s*(?:Rating|Genres?|Release Date|First Air Date|Audios?|Sources?|Star Cast|Download Links|$)`,
          "i",
        ),
      );
      return (m?.[1] || "").trim();
    };

    const tags = fieldOf("Genres")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && t.length < 30)
      .slice(0, 8);

    const cast = (
      $("em").first().text() || fieldOf("Star Cast")
    )
      .split(",")
      .map((c) => c.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 12);

    const ratingMatch = bodyText.match(/Rating\s*:?\s*([\d.]+)\s*\/\s*10/i);
    const rating = ratingMatch ? ratingMatch[1] : "";

    const image = absoluteUrl(
      $("meta[property='og:image']").attr("content") ||
        $("img[src*='image.tmdb.org']").first().attr("src") ||
        $("img").first().attr("src") ||
        "",
      baseUrl,
    );

    // Synopsis: the longest paragraph-ish block that is not boilerplate.
    let synopsis = $("meta[name='description']").attr("content")?.trim() || "";
    $("p").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (
        text.length > synopsis.length &&
        text.length > 60 &&
        !/download|search terms|available quality|#|tags ignore/i.test(text)
      ) {
        synopsis = text;
      }
    });

    // ---------------- download links ----------------
    // Each file is an anchor whose text is the size; the release filename is
    // the nearest preceding text node.
    const entries: Entry[] = [];
    const seen = new Set<string>();

    $("a[href]").each((_, el) => {
      const anchor = $(el);
      const href = (anchor.attr("href") || "").trim();
      if (!href || !FILE_HOSTS.test(href)) return;
      const url = absoluteUrl(href, baseUrl);
      if (seen.has(url)) return;
      seen.add(url);

      const size = anchor.text().replace(/\s+/g, " ").trim();

      // Walk back for the release filename.
      let filename = "";
      let node = anchor.parent();
      for (let i = 0; i < 4 && !filename; i++) {
        const text = node.text().replace(/\s+/g, " ").trim();
        const candidate = text
          .replace(size, "")
          .replace(/\s+/g, " ")
          .trim();
        if (/\.(mkv|mp4|zip)\b/i.test(candidate)) {
          filename = candidate.match(/\S*\.(?:mkv|mp4|zip)/i)?.[0] || candidate;
        }
        node = node.parent();
        if (!node || !node.length) break;
      }
      if (!filename) {
        filename =
          anchor.parent().prev().text().replace(/\s+/g, " ").trim() || size;
      }

      const { season, episode } = parseSeasonEpisode(filename);
      entries.push({
        label: shortLabel(filename, size),
        url,
        season,
        episode,
        quality: qualityOf(filename) || qualityOf(url),
      });
    });

    const linkList: Link[] = [];

    if (isSeries) {
      // Group episodes by season; keep season packs in their own bucket.
      const seasons = new Map<number, Entry[]>();
      const packs: Entry[] = [];

      for (const entry of entries) {
        if (entry.episode && entry.season) {
          const bucket = seasons.get(entry.season) || [];
          bucket.push(entry);
          seasons.set(entry.season, bucket);
        } else {
          packs.push(entry);
        }
      }

      for (const season of [...seasons.keys()].sort((a, b) => a - b)) {
        const items = (seasons.get(season) || []).sort((a, b) => {
          const byEp = (a.episode || 0) - (b.episode || 0);
          return byEp !== 0
            ? byEp
            : qualityRank(b.quality) - qualityRank(a.quality);
        });
        linkList.push({
          title: `Season ${season}`,
          directLinks: items.map((e) => ({
            title: `E${String(e.episode).padStart(2, "0")}${
              e.quality ? ` ${e.quality}` : ""
            }`,
            link: e.url,
            type: "series" as const,
          })),
        });
      }

      if (packs.length) {
        linkList.push({
          title: "Season Packs",
          directLinks: packs.map((e) => ({
            title: e.label,
            link: e.url,
            type: "series" as const,
          })),
        });
      }
    } else {
      const sorted = [...entries].sort(
        (a, b) => qualityRank(b.quality) - qualityRank(a.quality),
      );
      for (const entry of sorted) {
        linkList.push({
          title: entry.label,
          quality: entry.quality,
          directLinks: [
            { title: "Movie", link: entry.url, type: "movie" as const },
          ],
        });
      }
    }

    return {
      title,
      synopsis,
      image,
      poster: image,
      imdbId: "",
      type: isSeries ? "series" : "movie",
      tags,
      cast,
      rating: rating || undefined,
      linkList,
      webUrl: link,
    };
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getMeta", err);
  }
};
