import { Post, ProviderContext } from "../types";
import { getBaseUrl } from "../getBaseUrl";
import { throwProviderError } from "../providerErrors";

const providerValue = "roshy";
// Leave empty so the template does not accidentally scrape the adult domain.
// Set this (or the url in urls.json) to your intended non-adult site before use.
const defaultBaseUrl = "";

// WordPress movie/TV sites usually render post cards with one of these classes.
// When the intended non-adult site is wired up, adjust these selectors to match.
const CARD_SELECTOR =
  ".movie-card, .film-item, .post-item, article, .post, .film-list .item";
const TITLE_SELECTOR =
  ".movie-card-title, .film-name, .post-title, h2.entry-title, .title, h3";
const LINK_SELECTOR =
  "a.film-poster, a.movie-card, a.post-title, .post-thumbnail a, a.thumbnail, h2.entry-title a, a";
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
    throwProviderError("Roshy", "posts", error);
    return [];
  }
}

export async function getPosts({
  filter,
  page,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const baseUrl = (await getBaseUrl(providerValue)) || defaultBaseUrl;
  const cleanFilter = filter ? filter.replace(/\/+$/, "") : "";
  const pageUrl =
    page <= 1
      ? `${baseUrl}${cleanFilter}/`
      : `${baseUrl}${cleanFilter}/page/${page}/`;

  return fetchPosts(pageUrl, baseUrl, signal, providerContext);
}

export async function getSearchPosts({
  searchQuery,
  page,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const baseUrl = (await getBaseUrl(providerValue)) || defaultBaseUrl;
  const encodedQuery = encodeURIComponent(searchQuery.trim());
  const searchUrl =
    page <= 1
      ? `${baseUrl}/?s=${encodedQuery}`
      : `${baseUrl}/page/${page}/?s=${encodedQuery}`;

  return fetchPosts(searchUrl, baseUrl, signal, providerContext);
}
