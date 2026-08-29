import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  absolutise,
  cleanTitle,
  fetchPage,
  isZipLink,
} from "./client";

/** `mdrive.lol/archive/<id>` pages hold the per-quality file-host links. */
const ARCHIVE_HOST = /mdrive\.lol|\/archive\//i;

/** Pulls "Season 4" (or "S04") out of a quality heading. */
function seasonOf(text: string): number | undefined {
  const match =
    /season\s*(\d{1,2})/i.exec(text) || /\bS(\d{1,2})\b/.exec(text);
  return match ? parseInt(match[1], 10) : undefined;
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const { cheerio } = providerContext;

    // posts.ts stores a site-relative path so entries survive a domain change.
    const isAbsolute = /^https?:\/\//i.test(link);
    const { html, baseUrl } = await fetchPage({
      path: isAbsolute ? undefined : link.startsWith("/") ? link : `/${link}`,
      absoluteUrl: isAbsolute ? link : undefined,
      providerContext,
    });

    const $ = cheerio.load(html || "");
    const pageText = $("body").text();

    const rawTitle =
      $("h1").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      "";
    const title = cleanTitle(rawTitle);

    const imdbHref = $('a[href*="imdb.com/title/"]').first().attr("href") || "";
    const imdbId = (/(tt\d+)/.exec(imdbHref) || [])[1] || "";

    // Poster is the first content image that is not a screenshot/banner.
    let image = "";
    $("img").each((_, el) => {
      if (image) return;
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (!src) return;
      if (/telegram|logo|banner|\.svg$/i.test(src)) return;
      if (/catimages|vlcsnap|screenshot/i.test(src)) return;
      image = absolutise(src, baseUrl);
    });

    // Storyline runs until the next block (screenshots / download headings) or
    // simply to the end of its own line - the page uses single newlines, so a
    // blank-line terminator alone would never match.
    const synopsis =
      (/Storyline\s*[:\-–]?\s*([\s\S]{40,700}?)(?:\n\s*\n|\n(?=\s*(?:Screen|Download|The\s))|Screen-?Shots|DOWNLOAD LINKS|$)/i.exec(
        pageText,
      ) || [])[1]
        ?.replace(/\s+/g, " ")
        .trim() ||
      $('meta[name="description"]').attr("content") ||
      "";

    // A page is a series when its quality headings mention seasons/episodes.
    const isSeries =
      /season\s*\d|\bS\d{1,2}\b|episode|\bEp\d+/i.test(pageText) &&
      /season|episode/i.test(rawTitle + pageText.slice(0, 4000));

    /**
     * Each download option is an anchor to an mdrive archive page, preceded by
     * a heading describing the quality (and, for series, the season).
     */
    const entries: { label: string; url: string; season?: number }[] = [];
    const seenUrls = new Set<string>();

    $("a[href]").each((_, el) => {
      const node = $(el);
      const href = node.attr("href") || "";
      if (!href || !ARCHIVE_HOST.test(href)) return;

      const url = absolutise(href, baseUrl);
      if (seenUrls.has(url)) return;

      // The nearest preceding heading carries the quality/season description;
      // fall back to the anchor's own text.
      const ownText = node.text().replace(/\s+/g, " ").trim();
      const headingText = node
        .closest("h1,h2,h3,h4,h5,h6,p,div")
        .prevAll("h1,h2,h3,h4,h5,h6")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();

      const label = [headingText, ownText].filter(Boolean).join(" ").trim();
      if (isZipLink(label, url)) return;

      seenUrls.add(url);
      entries.push({ label: label || "Download", url, season: seasonOf(label) });
    });

    const linkList: Link[] = [];

    if (isSeries) {
      // Group by season so the app shows one row per season.
      const bySeason = new Map<number, { label: string; url: string }[]>();
      for (const entry of entries) {
        const key = entry.season ?? 1;
        if (!bySeason.has(key)) bySeason.set(key, []);
        bySeason.get(key)!.push(entry);
      }

      const seasons = Array.from(bySeason.keys()).sort((a, b) => a - b);
      for (const season of seasons) {
        for (const entry of bySeason.get(season) || []) {
          linkList.push({
            title: `Season ${season} - ${entry.label}`.slice(0, 120),
            quality: undefined,
            // Each archive page lists that season's episodes, so it has to be
            // expanded lazily by episodes.ts.
            episodesLink: entry.url,
          });
        }
      }
    } else {
      for (const entry of entries) {
        linkList.push({
          title: entry.label.slice(0, 120),
          directLinks: [
            { title: "Movie", link: entry.url, type: "movie" as const },
          ],
        });
      }
    }

    if (!linkList.length) {
      throw new Error(`no download links found on ${link}`);
    }

    const tags: string[] = [];
    const year = (/\((\d{4})\)/.exec(rawTitle) || [])[1];
    if (year) tags.push(year);
    $('a[href*="/category/"]').each((_, el) => {
      const name = $(el).text().replace(/\s+/g, " ").trim();
      if (name && name.length < 24 && tags.indexOf(name) < 0) tags.push(name);
    });

    return {
      title: title || link,
      synopsis,
      image,
      poster: image,
      imdbId,
      type: isSeries ? "series" : "movie",
      tags: tags.slice(0, 10),
      linkList,
      webUrl: absolutise(link, baseUrl),
    };
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getMeta", err);
  }
};
