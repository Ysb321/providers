import { Post, ProviderContext } from "../types";

// The intended non-adult movie/TV site's base URL. Set this (or configure
// `baseUrlOverride` in provider settings) before using the provider. It is
// intentionally left blank so this scaffold is not wired to any live site.
const defaultBaseUrl = "";

// WordPress movie/TV themes commonly render post cards with one of these
// selectors. Adjust to match the target site.
const CARD_SELECTOR =
  ".movie-card, .film-item, .post-item, article, .post, .film-list .item";
const TITLE_SELECTOR =
  ".movie-card-title, .film-name, .post-title, h2.entry-title, h3";
const LINK_SELECTOR =
  "a.film-poster, a.movie-card, a.post-title, h2.entry-title a, .post-thumbnail a, a";
const IMAGE_SELECTOR =
  "img.poster, img.film-poster, img.thumb, img.attachment-post-thumbnail, img";

function toPath(link: string, baseUrl: string): string {
  try {
    const url = new URL(link, baseUrl);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return link;
  }
}

async function fetchPosts(
  url: string,
  baseUrl: string,
  signal: AbortSignal,
  providerContext: ProviderContext,
): Promise<Post[]> {
  const { axios, cheerio, commonHeaders } = providerContext;
  try {
    const response = await axios.get(url, {
      headers: {
        ...commonHeaders,
        Referer: `${baseUrl}/`,
      },
      signal,
    });

    const $ = cheerio.load(response.data || "");
    const posts: Post[] = [];
    const seen = new Set<string>();

    $(CARD_SELECTOR).each((_, element) => {
      const card = $(element);
      const link =
        card.find(LINK_SELECTOR).first().attr("href") ||
        card.attr("href") ||
        "";
      const image =
        card.find(IMAGE_SELECTOR).first().attr("src") ||
        card.find("img").first().attr("data-src") ||
        card.find("img").first().attr("data-lazy-src") ||
        "";
      const title =
        card.find(TITLE_SELECTOR).first().text().replace(/\s+/g, " ").trim() ||
        card.find("img").first().attr("alt")?.trim() ||
        card.attr("aria-label")?.replace(/ details$/i, "")?.trim() ||
        "";

      if (title && link && !seen.has(link)) {
        seen.add(link);
        posts.push({
          title,
          link: toPath(link, baseUrl),
          image,
        });
      }
    });

    return posts;
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error(`Roshy posts error: ${error?.message || error}`);
    return [];
  }
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
  const baseUrl =
    (await providerContext.kvStore?.get<string>("baseUrlOverride")) ||
    defaultBaseUrl;
  if (!baseUrl) return [];

  const cleanFilter = filter ? filter.replace(/\/+$/, "") : "";
  const url =
    page <= 1
      ? `${baseUrl}${cleanFilter}/`
      : `${baseUrl}${cleanFilter}/page/${page}/`;

  return fetchPosts(url, baseUrl, signal, providerContext);
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
  const baseUrl =
    (await providerContext.kvStore?.get<string>("baseUrlOverride")) ||
    defaultBaseUrl;
  if (!baseUrl) return [];

  const encodedQuery = encodeURIComponent(searchQuery.trim());
  const url =
    page <= 1
      ? `${baseUrl}/?s=${encodedQuery}`
      : `${baseUrl}/page/${page}/?s=${encodedQuery}`;

  return fetchPosts(url, baseUrl, signal, providerContext);
};
