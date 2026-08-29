import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  absolutise,
  cleanTitle,
  fetchPage,
  isFileHost,
  isPackLink,
  isPlayerOnly,
  qualityFromText,
} from "./client";

/**
 * Episode blocks are introduced by an "EPiSODE N" heading followed by one line
 * of per-quality links (verified live on the Mousetrap S01 page).
 */
const EPISODE_HEADING = /\bEPi?SODE\s*0*(\d+)/i;

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const { cheerio } = providerContext;

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

    let image = "";
    $("img").each((_, el) => {
      if (image) return;
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (!src) return;
      if (/whatsapp|banner|logo|\.svg$/i.test(src)) return;
      if (/catimages|vlcsnap|myimg\.click/i.test(src)) return;
      image = absolutise(src, baseUrl);
    });

    // The page separates blocks with single newlines, so a blank-line
    // terminator alone would never match - stop at the next block or EOL.
    const synopsis =
      (/Storyline\s*[:\-–]?\s*([\s\S]{40,700}?)(?:\n\s*\n|\n(?=\s*(?:Review|Download|Screen))|Screen-?Shots|DOWNLOAD LINKS|$)/i.exec(
        pageText,
      ) || [])[1]
        ?.replace(/\s+/g, " ")
        .trim() ||
      $('meta[name="description"]').attr("content") ||
      "";

    const hasEpisodes = EPISODE_HEADING.test(pageText);
    const isSeries =
      hasEpisodes || /\(Season\s*\d|\bS\d{2}\b|All Episodes/i.test(rawTitle);

    const linkList: Link[] = [];

    if (isSeries && hasEpisodes) {
      /**
       * Walk the document in order: an "EPiSODE N" heading opens a bucket, and
       * every file-host anchor after it belongs to that episode until the next
       * heading. Season packs are skipped - they are archives, not playable.
       */
      type Bucket = { episode: number; links: { label: string; url: string }[] };
      const buckets: Bucket[] = [];
      let current: Bucket | null = null;

      $("body *").each((_, el) => {
        const tag = (el as any).tagName?.toLowerCase?.() || "";
        const node = $(el);

        if (/^(h1|h2|h3|h4|h5|h6|strong|b|p)$/.test(tag)) {
          const text = node.text().replace(/\s+/g, " ").trim();
          const match = EPISODE_HEADING.exec(text);
          // Only treat it as a heading when the episode marker is the whole
          // label, not a passing mention inside a paragraph of links.
          if (match && text.length < 40) {
            current = { episode: parseInt(match[1], 10), links: [] };
            buckets.push(current);
          }
          return;
        }

        if (tag === "a") {
          const href = node.attr("href") || "";
          if (!href || !isFileHost(href) || isPlayerOnly(href)) return;
          const url = absolutise(href, baseUrl);
          const label = node.text().replace(/\s+/g, " ").trim();
          if (isPackLink(label, url)) return;

          // The quality sits in the text just before the link ("720p - Drive").
          const lineText = node
            .closest("h1,h2,h3,h4,h5,h6,p,div")
            .text()
            .replace(/\s+/g, " ")
            .trim();
          const quality = qualityFromText(lineText) || "";

          if (current) {
            current.links.push({
              label: `${quality ? quality + "p " : ""}${label || "Drive"}`.trim(),
              url,
            });
          }
        }
      });

      const withLinks = buckets.filter((b) => b.links.length);
      if (withLinks.length) {
        // One row per quality, each holding every episode at that quality, so
        // the app can present a normal episode list.
        const qualities = new Set<string>();
        for (const bucket of withLinks) {
          for (const l of bucket.links) {
            qualities.add(qualityFromText(l.label) || "other");
          }
        }

        for (const quality of Array.from(qualities).sort()) {
          const directLinks = withLinks
            .map((bucket) => {
              const match = bucket.links.find(
                (l) => (qualityFromText(l.label) || "other") === quality,
              );
              if (!match) return null;
              return {
                title: `Episode ${bucket.episode}`,
                link: match.url,
                type: "series" as const,
              };
            })
            .filter(Boolean) as {
            title: string;
            link: string;
            type: "series";
          }[];

          if (directLinks.length) {
            linkList.push({
              title: quality === "other" ? "Episodes" : `${quality}p`,
              quality: quality === "other" ? undefined : quality,
              directLinks,
            });
          }
        }
      }
    }

    // Movies (and series pages without per-episode links) expose one anchor
    // per quality straight to a file host.
    if (!linkList.length) {
      const seen = new Set<string>();
      $("a[href]").each((_, el) => {
        const node = $(el);
        const href = node.attr("href") || "";
        if (!href || !isFileHost(href) || isPlayerOnly(href)) return;

        const url = absolutise(href, baseUrl);
        if (seen.has(url)) return;

        const label =
          node.text().replace(/\s+/g, " ").trim() ||
          node.parent().text().replace(/\s+/g, " ").trim();
        if (isPackLink(label, url)) return;

        seen.add(url);
        linkList.push({
          title: label.slice(0, 100) || "Download",
          quality: qualityFromText(label),
          directLinks: [
            {
              title: isSeries ? "Play" : "Movie",
              link: url,
              type: isSeries ? ("series" as const) : ("movie" as const),
            },
          ],
        });
      });
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
