import { EpisodeLink, ProviderContext } from "../types";
import { absolutise, fetchPage, isFileHost, isZipLink } from "./client";

/**
 * Expands an `mdrive.lol/archive/<id>` page into its episode list.
 *
 * Layout (verified live): a heading per episode ("EP01 - 720p [313.32 MB]")
 * followed by one anchor per file host (HubCloud, GDFliX). Both hosts point at
 * the same file, so the episode is emitted once with the HubCloud link
 * preferred - stream.ts falls back to the other host if it fails.
 */
export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  try {
    const { cheerio } = providerContext;
    const { html, baseUrl } = await fetchPage({
      absoluteUrl: url,
      providerContext,
    });

    const $ = cheerio.load(html || "");

    type Bucket = { title: string; links: string[] };
    const buckets: Bucket[] = [];
    let current: Bucket | null = null;

    $("body *").each((_, el) => {
      const tag = (el as any).tagName?.toLowerCase?.() || "";
      const node = $(el);

      if (/^(h1|h2|h3|h4|h5|h6|strong|b)$/.test(tag)) {
        const text = node.text().replace(/\s+/g, " ").trim();
        // A heading naming an episode starts a new bucket.
        if (text && /\bep\s*\d+|episode\s*\d+/i.test(text)) {
          current = { title: text, links: [] };
          buckets.push(current);
        }
        return;
      }

      if (tag === "a") {
        const href = node.attr("href") || "";
        if (!href || !isFileHost(href)) return;
        const link = absolutise(href, baseUrl);
        const label = node.text().replace(/\s+/g, " ").trim();
        if (isZipLink(`${current?.title || ""} ${label}`, link)) return;
        if (current) current.links.push(link);
      }
    });

    const episodes: EpisodeLink[] = [];
    const seen = new Set<string>();

    for (const bucket of buckets) {
      if (!bucket.links.length) continue;
      // Prefer HubCloud - it exposes more mirrors than GDFlix.
      const preferred =
        bucket.links.find((l) => /hubcloud|hubdrive|hubcdn/i.test(l)) ||
        bucket.links[0];
      if (seen.has(preferred)) continue;
      seen.add(preferred);

      const num = (/\bep\s*0*(\d+)|episode\s*0*(\d+)/i.exec(bucket.title) ||
        [])[1];
      const parsed = parseInt(num || "0", 10);

      episodes.push({
        title: parsed ? `Episode ${parsed}` : bucket.title.slice(0, 80),
        link: preferred,
      });
    }

    // A season page with a single file (no per-episode headings) is still
    // playable - surface it rather than returning nothing.
    if (!episodes.length) {
      const fallback: string[] = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (href && isFileHost(href) && !isZipLink($(el).text(), href)) {
          fallback.push(absolutise(href, baseUrl));
        }
      });
      const preferred =
        fallback.find((l) => /hubcloud|hubdrive|hubcdn/i.test(l)) ||
        fallback[0];
      if (preferred) episodes.push({ title: "Play", link: preferred });
    }

    return episodes.sort((a, b) => {
      const parse = (v: string) =>
        parseInt((/Episode (\d+)/.exec(v) || [])[1] || "0", 10);
      return parse(a.title) - parse(b.title);
    });
  } catch (err) {
    console.error("moviesDrive getEpisodes error:", err);
    return [];
  }
};
