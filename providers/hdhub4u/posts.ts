import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  cleanTitle,
  fetchPage,
  toRelativePath,
} from "./client";

const IGNORE_HREF =
  /\/(category|tag|page|author|about|contact|dmca|privacy|how-to-download|feed)\b|whatsapp\.com|t\.me\/|\.apk$|#/i;

function collect(
  html: string,
  baseUrl: string,
  providerContext: ProviderContext,
): Post[] {
  const { cheerio } = providerContext;
  const $ = cheerio.load(html || "");
  const posts: Post[] = [];
  const seen = new Set<string>();

  // Listing items pair a poster <img> with the post permalink. The anchor and
  // the image are siblings inside an <li>, so search from the image outwards.
  $("img").each((_, el) => {
    const img = $(el);
    const image =
      img.attr("src") || img.attr("data-src") || img.attr("data-lazy-src") || "";
    if (!image || /whatsapp|banner|logo|\.svg$/i.test(image)) return;

    const container = img.closest("li, article, div");
    const anchor = container.find('a[href]').filter((_i, a) => {
      const href = $(a).attr("href") || "";
      return Boolean(href) && !IGNORE_HREF.test(href);
    }).first();

    const href = anchor.attr("href") || "";
    if (!href) return;

    const relative = toRelativePath(href, baseUrl);
    // Post permalinks are one slug deep off the site root.
    if (!/^\/[^/]+\/?$/.test(relative)) return;
    if (seen.has(relative)) return;

    const title = cleanTitle(
      anchor.text() || img.attr("alt") || anchor.attr("title") || "",
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

    const { html, baseUrl } = await fetchPage({ path, providerContext, signal });
    return collect(html, baseUrl, providerContext);
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getPosts", err);
  }
};

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

    // WordPress search; paging uses the /page/N/ prefix before the query.
    const path =
      page && page > 1
        ? `/page/${page}/?s=${encodeURIComponent(query)}`
        : `/?s=${encodeURIComponent(query)}`;

    const { html, baseUrl } = await fetchPage({ path, providerContext, signal });
    return collect(html, baseUrl, providerContext);
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
