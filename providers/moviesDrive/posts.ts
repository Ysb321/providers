import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  absolutise,
  cleanTitle,
  fetchPage,
  fetchSearch,
  toRelativePath,
} from "./client";

/** Anchors that are navigation/chrome rather than a title. */
const IGNORE_HREF =
  /\/(category|tag|page|author|about|contact|dmca|privacy|how-to|announcements)\b|\?s=|t\.me\/|#/i;

function collect(
  html: string,
  baseUrl: string,
  providerContext: ProviderContext,
): Post[] {
  const { cheerio } = providerContext;
  const $ = cheerio.load(html || "");
  const posts: Post[] = [];
  const seen = new Set<string>();

  // The grid is a list of anchors wrapping a poster <img> plus the title text.
  $("a[href]").each((_, el) => {
    const node = $(el);
    const href = node.attr("href") || "";
    if (!href || IGNORE_HREF.test(href)) return;

    const img = node.find("img").first();
    if (!img.length) return;

    const image =
      img.attr("src") ||
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      "";
    // Posters are TMDB/IMDB/CDN hosted; skip site chrome (telegram banners etc).
    if (!image || /telegram|logo|banner|\.svg$/i.test(image)) return;

    const link = absolutise(href, baseUrl);
    // Post permalinks are single-segment slugs off the site root.
    if (!/^https?:\/\/[^/]+\/[^/]+\/?$/.test(link)) return;

    const relative = toRelativePath(link, baseUrl);
    if (seen.has(relative)) return;

    const title = cleanTitle(
      node.attr("title") || img.attr("alt") || node.text() || "",
    );
    if (!title) return;

    seen.add(relative);
    posts.push({ title, link: relative, image });
  });

  return posts;
}

export const getPosts = async function ({
  filter,
  page,
  providerValue,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    const clean = (filter || "").replace(/^\/+/, "").replace(/\/+$/, "");
    const pageSuffix = page && page > 1 ? `page/${page}/` : "";
    const path = clean ? `/${clean}/${pageSuffix}` : `/${pageSuffix}`;

    const { html, baseUrl } = await fetchPage({
      path,
      providerContext,
      signal,
    });
    return collect(html, baseUrl, providerContext);
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getPosts", err);
  }
};

interface SearchHit {
  document?: {
    permalink?: string;
    post_title?: string;
    post_thumbnail?: string;
  };
}

export const getSearchPosts = async function ({
  searchQuery,
  page,
  providerValue,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    const query = (searchQuery || "").trim();
    if (!query) return [];

    // The site exposes a Typesense-backed JSON search - far more reliable
    // than scraping the rendered results page.
    const { payload, baseUrl } = await fetchSearch({
      query,
      page: Math.max(1, page),
      providerContext,
      signal,
    });

    const hits: SearchHit[] = payload?.hits || [];
    const posts: Post[] = [];
    const seen = new Set<string>();

    for (const hit of hits) {
      const doc = hit?.document;
      if (!doc?.permalink || !doc?.post_title) continue;

      const relative = toRelativePath(doc.permalink, baseUrl);
      if (seen.has(relative)) continue;
      seen.add(relative);

      posts.push({
        title: cleanTitle(doc.post_title),
        link: relative,
        image: doc.post_thumbnail
          ? absolutise(doc.post_thumbnail, baseUrl)
          : "",
      });
    }

    return posts;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
