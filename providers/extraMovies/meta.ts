import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  absoluteUrl,
  fetchPage,
  fullSizeImage,
  getBaseUrl,
  PROVIDER_NAME,
} from "./client";

/** Hosts we know how to resolve into a playable/downloadable file. */
const SUPPORTED_HOSTS =
  /(hubcloud|hubdrive|vcloud|gdflix|gdlink|gofile|pixeldrain|filepress|gdtot|driveleech|driveseed|workers\.dev)/i;

function isSeries(title: string, html: string): boolean {
  return (
    /\b(season|s\d{1,2}\s?e\d{1,2}|episode|web[\s-]?series|complete)\b/i.test(
      title,
    ) || /\bS\d{2}E\d{2}\b/i.test(html)
  );
}

/** Pulls "480p", "1080p", "2160p"/"4K" out of a heading. */
function qualityOf(text: string): string | undefined {
  const t = (text || "").toLowerCase();
  if (/2160p|\b4k\b/.test(t)) return "2160p";
  if (/1080p/.test(t)) return "1080p";
  if (/720p/.test(t)) return "720p";
  if (/480p/.test(t)) return "480p";
  if (/360p/.test(t)) return "360p";
  return undefined;
}

/** "Kantara ... 720p x264 [1.6GB]" -> "720p x264 [1.6GB]" */
function shortLabel(text: string): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  // Episode files must keep their SxxExx marker, otherwise every episode in a
  // season collapses to the same "720p [350MB]" label.
  const episode = cleaned.match(/\bS\d{1,2}\s?E\d{1,3}\b/i);
  const quality = cleaned.match(
    /((?:480p|720p|1080p|2160p|4K)[^\[]*(?:\[[^\]]*\])?)\s*$/i,
  );
  if (episode) {
    return quality
      ? `${episode[0].toUpperCase()} ${quality[1]}`.trim()
      : episode[0].toUpperCase();
  }
  return (quality ? quality[1] : cleaned).trim();
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

    const rawTitle = (
      $("h1.entry-title").first().text() ||
      $(".post-title").first().text() ||
      $("h1").first().text() ||
      $("meta[property='og:title']").attr("content") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();

    const title = rawTitle
      .replace(/^Download\s+/i, "")
      .replace(/\s*»\s*ExtraMovies.*$/i, "")
      .trim();

    // The post body holds the info block; prefer the StoryLine paragraph.
    const bodyText = $(".entry-content, .post-content, article")
      .first()
      .text()
      .replace(/\s+/g, " ");

    let synopsis = "";
    const storyMatch = bodyText.match(
      /(?:StoryLine|story\s*…|Storyline|SYNOPSIS)\s*:?\s*(.{60,900}?)(?:Screenshots|Download|🔗|$)/i,
    );
    if (storyMatch) synopsis = storyMatch[1].replace(/^[\s.·•–—-]+/, "").trim();
    if (!synopsis) {
      synopsis =
        $("meta[property='og:description']").attr("content")?.trim() || "";
    }

    // Poster: the first content image that is not a screenshot/logo.
    let image = "";
    $(".entry-content img, article img, .post-content img").each((_, el) => {
      if (image) return;
      const src =
        $(el).attr("data-src") || $(el).attr("src") || $(el).attr("data-lazy-src") || "";
      if (!src) return;
      if (/catimages|screenshot|vlcsnap|logo|cropped|smiley|icon/i.test(src))
        return;
      image = src;
    });
    if (!image) {
      image = $("meta[property='og:image']").attr("content") || "";
    }
    image = fullSizeImage(absoluteUrl(image, baseUrl));

    const imdbMatch = html.match(/tt\d{7,10}/);
    const imdbId = imdbMatch ? imdbMatch[0] : "";

    const ratingMatch = bodyText.match(/iMDB\s*Rating\s*:?\s*([\d.]+)\s*\/\s*10/i);
    const rating =
      ratingMatch && parseFloat(ratingMatch[1]) > 0 ? ratingMatch[1] : "";

    // The info block is a run-on of "Label: value" pairs. Stop each value at
    // the next known label (or an emoji bullet) so fields do not bleed into
    // one another - e.g. Genre must not swallow the Director/Stars that follow.
    const NEXT_LABEL =
      "(?=\\s*(?:[🎬👮✍⭐🗣🎵🎙🌟📅🕒🔗]|Movie\\s*Name|Genre|Director|Writer|Stars?|Cast|Language|Quality|Format|Size|Release|Runtime|Subtitle|StoryLine|Story|Screenshots?|Download|Winding|S\\d{2}E\\d{2}|\\d{3,4}p|$))";

    // Each "Label: value" pair normally lives in its own <p>/<li>, which gives
    // a natural boundary. Reading blocks first prevents a value from running
    // into the next heading (the flattened-text version of this cannot tell
    // "Divyanka Tripathi" from "Divyanka Tripathi Adrishyam S01E01 ...").
    const blocks: string[] = [];
    $(".entry-content p, .entry-content li, .post-content p, article p, article li").each(
      (_, el) => {
        const t = $(el).text().replace(/\s+/g, " ").trim();
        if (t) blocks.push(t);
      },
    );

    const fieldOf = (label: string, max = 200): string => {
      const blockRe = new RegExp(`^[^A-Za-z0-9]{0,4}${label}\\s*:?\\s*(.+)$`, "i");
      for (const block of blocks) {
        const hit = block.match(blockRe);
        if (hit?.[1]) return hit[1].trim();
      }
      const re = new RegExp(`${label}\\s*:?\\s*(.{3,${max}}?)${NEXT_LABEL}`, "i");
      return (bodyText.match(re) || [])[1]?.trim() || "";
    };

    const splitList = (value: string, limit: number): string[] =>
      value
        .split(/[,|/]/)
        .map((t) =>
          t
            .replace(/\s+/g, " ")
            // a value can run into the next block heading (no separator in the
            // flattened text) - cut at a title-cased word that starts one.
            .replace(
              /\s+(?:Screenshots?|Download|StoryLine|Story|Winding|Quality|Format|Language|Release|Trailer|Watch|Join)\b.*$/i,
              "",
            )
            .trim(),
        )
        .filter((t) => t && t.length > 1 && t.length < 40)
        .slice(0, limit);

    const tags = splitList(fieldOf("Genre", 120), 8);
    const cast = splitList(fieldOf("(?:Stars|Cast)", 220), 12);

    const type = isSeries(title, html) ? "series" : "movie";

    // ---------------- download links ----------------
    // Layout: a heading (h3/h4/strong) describing the file, followed by the
    // "DOWNLOAD NOW" anchor pointing at hubcloud/gdflix.
    const linkList: Link[] = [];
    const seen = new Set<string>();

    $("a[href]").each((_, el) => {
      const anchor = $(el);
      const href = (anchor.attr("href") || "").trim();
      if (!href || !SUPPORTED_HOSTS.test(href)) return;
      if (seen.has(href)) return;
      seen.add(href);

      // Walk backwards for the nearest descriptive heading.
      let label = "";
      const container = anchor.closest("p, div, li");
      let node = container.length ? container : anchor;
      for (let i = 0; i < 6 && !label; i++) {
        node = node.prev();
        if (!node || !node.length) break;
        const text = node.text().replace(/\s+/g, " ").trim();
        if (text && !/^\s*(🔗|DOWNLOAD NOW)/i.test(text) && text.length > 8) {
          label = text;
        }
      }
      if (!label) {
        label = anchor.text().replace(/\s+/g, " ").trim();
      }

      const quality = qualityOf(label) || qualityOf(href) || undefined;
      const display = shortLabel(label) || quality || "Download";

      linkList.push({
        title: display,
        quality,
        directLinks: [
          {
            title: type === "series" ? display : "Movie",
            link: href,
            type: type === "series" ? "series" : "movie",
          },
        ],
      });
    });

    // Sort by resolution, best first.
    const rank = (q?: string) => {
      const n = parseInt((q || "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    };
    linkList.sort((a, b) => rank(b.quality) - rank(a.quality));

    return {
      title,
      synopsis,
      image,
      poster: image,
      imdbId,
      type,
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
