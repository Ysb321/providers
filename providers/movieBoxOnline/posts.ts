import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  apiUrl,
  fullImage,
  getBaseUrl,
  getHtml,
  getJson,
} from "./client";
import { parseNuxtData } from "./nuxt";

const PAGE_SIZE = 18;

type Subject = {
  subjectId?: string;
  subjectType?: number;
  title?: string;
  cover?: { url?: string };
  hasResource?: boolean;
  detailPath?: string;
};

/** subjectType 1 = movie, 2 = tv/series. */
const MOVIE_TYPE = 1;
const SERIES_TYPE = 2;

function toPost(subject: Subject): Post | null {
  if (!subject?.detailPath || !subject?.title) return null;
  if (subject.hasResource === false) return null;
  return {
    title: subject.title,
    // The link is the detailPath - meta/stream rebuild URLs from it.
    link: subject.detailPath,
    image: fullImage(subject.cover?.url),
  };
}

/**
 * Walks arbitrary decoded Nuxt payloads collecting anything that looks like a
 * subject. Search has no public JSON endpoint on this domain, so results are
 * recovered from the server-rendered page state.
 */
function collectSubjects(value: unknown): Subject[] {
  const found: Subject[] = [];
  const seen = new Set<object>();

  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current as object);

    const node = current as Record<string, unknown>;
    if (typeof node.detailPath === "string" && node.detailPath) {
      const cover = node.cover as { url?: string } | undefined;
      found.push({
        subjectId:
          typeof node.subjectId === "string" ? node.subjectId : undefined,
        subjectType:
          typeof node.subjectType === "number" ? node.subjectType : undefined,
        title: typeof node.title === "string" ? node.title : undefined,
        cover: cover && typeof cover === "object" ? cover : undefined,
        hasResource:
          typeof node.hasResource === "boolean" ? node.hasResource : undefined,
        detailPath: node.detailPath,
      });
    }
    Object.values(node).forEach(visit);
  };

  visit(value);
  return found;
}

/** Trending API - the only list endpoint this domain exposes as JSON. */
async function fetchTrending({
  page,
  subjectType,
  providerContext,
  signal,
}: {
  page: number;
  subjectType?: number;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const baseUrl = await getBaseUrl(providerContext);
  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    perPage: String(PAGE_SIZE),
  });

  const data = await getJson<{ subjectList?: Subject[] }>({
    url: apiUrl(baseUrl, `/wefeed-h5api-bff/subject/trending?${params}`),
    providerContext,
    signal,
    referer: baseUrl + "/",
  });

  let list = data?.subjectList || [];
  if (subjectType !== undefined) {
    list = list.filter(
      (s) => s.subjectType === undefined || s.subjectType === subjectType,
    );
  }
  return list.map(toPost).filter((p): p is Post => Boolean(p));
}

/** Scrapes a rendered listing/search page out of the embedded Nuxt state. */
async function fetchFromPage({
  path,
  providerContext,
  signal,
  subjectType,
}: {
  path: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
  subjectType?: number;
}): Promise<Post[]> {
  const baseUrl = await getBaseUrl(providerContext);
  const html = await getHtml({
    url: `${baseUrl}${path}`,
    providerContext,
    signal,
    referer: baseUrl + "/",
  });

  const posts: Post[] = [];
  const seen = new Set<string>();

  const push = (subject: Subject) => {
    if (
      subjectType !== undefined &&
      subject.subjectType !== undefined &&
      subject.subjectType !== subjectType
    ) {
      return;
    }
    const post = toPost(subject);
    if (post && !seen.has(post.link)) {
      seen.add(post.link);
      posts.push(post);
    }
  };

  try {
    collectSubjects(parseNuxtData(html, providerContext.cheerio)).forEach(push);
  } catch (err) {
    console.log("movieBoxOnline: could not decode Nuxt state:", err);
  }

  // Fallback: anchors to /movies/<detailPath> rendered in the markup.
  if (!posts.length) {
    const $ = providerContext.cheerio.load(html || "");
    $("a[href*='/movies/']").each((_, el) => {
      const anchor = $(el);
      const href = anchor.attr("href") || "";
      const detailPath = href.split("/movies/")[1]?.split(/[?#]/)[0];
      if (!detailPath || seen.has(detailPath)) return;
      const img = anchor.find("img").first();
      const title = (
        img.attr("alt") ||
        anchor.attr("title") ||
        anchor.text()
      )
        .replace(/-full$/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!title) return;
      seen.add(detailPath);
      posts.push({
        title,
        link: detailPath,
        image: fullImage(img.attr("data-src") || img.attr("src")),
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
    switch (filter) {
      case "movies":
        // No paged JSON endpoint for the movie tab - use trending, filtered.
        return page > 1
          ? await fetchTrending({
              page,
              subjectType: MOVIE_TYPE,
              providerContext,
              signal,
            })
          : await fetchFromPage({
              path: "/film",
              providerContext,
              signal,
              subjectType: MOVIE_TYPE,
            });
      case "tv-series":
        return page > 1
          ? await fetchTrending({
              page,
              subjectType: SERIES_TYPE,
              providerContext,
              signal,
            })
          : await fetchFromPage({
              path: "/tv-series",
              providerContext,
              signal,
              subjectType: SERIES_TYPE,
            });
      case "animated-series":
        if (page > 1) return [];
        return await fetchFromPage({
          path: "/animated-series",
          providerContext,
          signal,
        });
      case "trending":
      default:
        return await fetchTrending({ page, providerContext, signal });
    }
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
    if (!query || page > 1) return [];
    return await fetchFromPage({
      path: `/searchResult?keyword=${encodeURIComponent(query)}`,
      providerContext,
      signal,
    });
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
