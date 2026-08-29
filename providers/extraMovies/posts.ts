import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  absoluteUrl,
  fetchPage,
  fullSizeImage,
  getBaseUrl,
  PROVIDER_NAME,
} from "./client";

// GridShow theme markup, newest skins first.
const POST_SELECTORS = [
  "article",
  ".gridshow-post-item",
  ".post-item",
  ".gridshow-posts-wrapper .post",
  "#gridshow-posts-wrapper .item",
];

function cleanTitle(raw: string): string {
  return (raw || "")
    .replace(/^\s*Permanent Link to\s*/i, "")
    .replace(/^\s*Download\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPosts({
  path,
  query,
  page,
  signal,
  providerContext,
}: {
  path?: string;
  query?: string;
  page: number;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const { cheerio } = providerContext;
  const baseUrl = await getBaseUrl(providerContext);

  let url: string;
  if (query) {
    // WordPress search: /?s=term  (paged: /page/N/?s=term)
    url =
      page > 1
        ? `${baseUrl}/page/${page}/?s=${encodeURIComponent(query)}`
        : `${baseUrl}/?s=${encodeURIComponent(query)}`;
  } else {
    const clean = (path || "").replace(/^\/+/, "").replace(/\/+$/, "");
    const suffix = page > 1 ? `page/${page}/` : "";
    url = clean ? `${baseUrl}/${clean}/${suffix}` : `${baseUrl}/${suffix}`;
  }

  const html = await fetchPage({
    url,
    providerContext,
    signal,
    referer: baseUrl + "/",
  });

  const $ = cheerio.load(html || "");
  const posts: Post[] = [];
  const seen = new Set<string>();

  const isContentLink = (href: string): boolean => {
    if (!href) return false;
    if (!href.includes(baseUrl.replace(/^https?:\/\//, ""))) {
      if (/^https?:\/\//i.test(href)) return false;
    }
    // skip nav / taxonomy / utility pages
    return !/\/(category|tag|author|page|how-to-download|wp-|feed)\b/i.test(
      href,
    ) && !href.includes("#");
  };

  const addFrom = (el: any) => {
    const item = $(el);
    // the title anchor carries the real name; the thumb anchor carries the img
    const titleAnchor = item
      .find("h2 a, h3 a, .entry-title a, .post-title a")
      .first();
    const thumbAnchor = item.find("a[href]").first();

    const href =
      titleAnchor.attr("href") || thumbAnchor.attr("href") || "";
    if (!isContentLink(href)) return;

    const link = absoluteUrl(href, baseUrl);
    if (seen.has(link)) return;

    const title = cleanTitle(
      titleAnchor.text() ||
        titleAnchor.attr("title") ||
        thumbAnchor.attr("title") ||
        item.find("img").first().attr("alt") ||
        "",
    );
    if (!title) return;

    const img = item.find("img").first();
    const rawImage =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-original") ||
      img.attr("src") ||
      "";

    seen.add(link);
    posts.push({
      title,
      link,
      image: fullSizeImage(absoluteUrl(rawImage, baseUrl)),
    });
  };

  for (const selector of POST_SELECTORS) {
    $(selector).each((_, el) => addFrom(el));
    if (posts.length) break;
  }

  // Fallback: the theme sometimes renders a flat list of thumb anchors with a
  // "Permanent Link to ..." title attribute and no article wrapper.
  if (!posts.length) {
    $("a[title^='Permanent Link'], a[rel='bookmark']").each((_, el) => {
      const anchor = $(el);
      const href = anchor.attr("href") || "";
      if (!isContentLink(href)) return;
      const link = absoluteUrl(href, baseUrl);
      if (seen.has(link)) return;

      const title = cleanTitle(
        anchor.attr("title") || anchor.text() || anchor.find("img").attr("alt") || "",
      );
      if (!title) return;

      const img = anchor.find("img").first();
      seen.add(link);
      posts.push({
        title,
        link,
        image: fullSizeImage(
          absoluteUrl(img.attr("data-src") || img.attr("src") || "", baseUrl),
        ),
      });
    });
  }

  return posts;
}

export const getPosts = async function ({
  filter,
  page = 1,
  providerValue,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue?: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    return await fetchPosts({ path: filter, page, signal, providerContext });
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getPosts", err);
  }
};

export const getSearchPosts = async function ({
  searchQuery,
  page = 1,
  providerValue,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue?: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    const query = (searchQuery || "").trim();
    if (!query) return [];
    return await fetchPosts({ query, page, signal, providerContext });
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
