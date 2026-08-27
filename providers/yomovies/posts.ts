import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { absoluteUrl, fetchPage, getBaseUrl, PROVIDER_NAME } from "./client";

const POST_SELECTORS = [
  ".ml-item",
  ".movies-list .ml-item",
  "#movie-featured .ml-item",
  ".item_movie",
  ".result-item",
];

async function fetchPosts({
  path,
  page,
  signal,
  providerContext,
}: {
  path: string;
  page: number;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const { cheerio } = providerContext;
  const baseUrl = await getBaseUrl(providerContext);

  const cleanPath = (path || "").replace(/^\/+/, "").replace(/\/+$/, "");
  const pageSuffix = page && page > 1 ? `page/${page}/` : "";
  const url = cleanPath
    ? `${baseUrl}/${cleanPath}/${pageSuffix}`
    : `${baseUrl}/${pageSuffix}`;

  const html = await fetchPage({
    url,
    providerContext,
    signal,
    referer: baseUrl + "/",
  });

  const $ = cheerio.load(html || "");
  const posts: Post[] = [];
  const seen = new Set<string>();

  const collect = (selector: string) => {
    $(selector).each((_, el) => {
      const item = $(el);

      // the poster anchor - PsyPlay uses a.ml-mask, older skins plain <a>
      const anchor = item.find("a.ml-mask").first().length
        ? item.find("a.ml-mask").first()
        : item.find("a[href]").first();

      const href = anchor.attr("href") || "";
      if (!href || href.startsWith("#")) return;

      const link = absoluteUrl(href, baseUrl);
      // skip login / favourite / category anchors
      if (!/\/[^/]+\/?$/.test(link) || /#pt-login/.test(link)) return;
      if (seen.has(link)) return;

      const title = (
        anchor.attr("title") ||
        item.find(".mli-info h2").first().text() ||
        item.find("h2").first().text() ||
        item.find("img").first().attr("alt") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!title) return;

      const img = item.find("img").first();
      const rawImage =
        img.attr("data-original") ||
        img.attr("data-src") ||
        img.attr("data-lazy-src") ||
        img.attr("src") ||
        "";
      const image = absoluteUrl(rawImage, baseUrl);

      seen.add(link);
      posts.push({ title, link, image });
    });
  };

  for (const selector of POST_SELECTORS) {
    collect(selector);
    if (posts.length) break;
  }

  // Last-resort fallback: every anchor that looks like a yomovies watch page.
  if (!posts.length) {
    $("a[href*='-Watch-online-full-movie']").each((_, el) => {
      const anchor = $(el);
      const link = absoluteUrl(anchor.attr("href") || "", baseUrl);
      if (!link || seen.has(link)) return;
      const title = (
        anchor.attr("title") ||
        anchor.find("img").attr("alt") ||
        anchor.text()
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!title) return;
      const img = anchor.find("img").first();
      seen.add(link);
      posts.push({
        title,
        link,
        image: absoluteUrl(
          img.attr("data-original") || img.attr("src") || "",
          baseUrl,
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
    // yomovies search is a path segment: /search/<query>/
    const slug = encodeURIComponent(query).replace(/%20/g, "+");
    return await fetchPosts({
      path: `search/${slug}`,
      page,
      signal,
      providerContext,
    });
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
