import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  apiHeaders,
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

/**
 * Search hosts. movieboxonline.net does not expose a search route at all
 * (every path 404s, and its API has no search endpoint), but the same wefeed
 * backend is deployed on sibling MovieBox domains that DO serve
 * /newWeb/searchResult - which is exactly what the reference movieBoxWeb
 * provider scrapes. Results carry a `detailPath`, which is host-independent,
 * so a title found on a mirror still plays through this domain's play API.
 */
const SEARCH_HOSTS = [
  "https://officialmoviebox.com",
  "https://moviebox.ng",
  "https://moviebox.ph",
];

const SEARCH_PATHS = [
  "/newWeb/searchResult?keyword=",
  "/searchResult?keyword=",
  "/search?keyword=",
];

const SEARCH_ORIGIN_KEY = "movieBoxOnlineSearchOrigin";

/**
 * POST search endpoints, tried against the site's own API first.
 * The reference movieBox provider confirms this backend's search is POST-only,
 * so a GET probe returning 404 does not prove the route is absent.
 */
const SEARCH_ENDPOINTS = [
  "/wefeed-h5api-bff/subject-api/search/v2",
  "/wefeed-h5api-bff/subject/search/v2",
  "/wefeed-mobile-bff/subject-api/search/v2",
];

const SEARCH_ENDPOINT_KEY = "movieBoxOnlineSearchEndpoint";

/** Pulls subjects out of any response shape the API is known to return. */
function subjectsFromSearchPayload(data: any): Subject[] {
  if (!data) return [];
  const buckets: Subject[][] = [
    data.subjectList,
    data.subjects,
    data.items,
    ...(Array.isArray(data.results)
      ? data.results.map((r: any) => r?.subjects || r?.subjectList)
      : []),
  ].filter(Array.isArray) as Subject[][];

  if (buckets.length) return buckets.flat();
  return collectSubjects(data);
}

/**
 * The reference provider talks to this backend with `fetch`, not axios, so we
 * use the same transport here and only fall back to axios if fetch is absent.
 */
async function postJson(
  url: string,
  body: unknown,
  providerContext: ProviderContext,
  signal?: AbortSignal,
): Promise<any> {
  const headers = {
    ...apiHeaders,
    "Content-Type": "application/json",
  };

  if (typeof fetch === "function") {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  const res = await (providerContext.axios as any).post(url, body, {
    headers,
    signal,
  });
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
}

async function searchViaApi({
  query,
  page,
  providerContext,
  signal,
}: {
  query: string;
  page: number;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const baseUrl = await getBaseUrl(providerContext);

  let endpoints = [...SEARCH_ENDPOINTS];
  try {
    const remembered =
      await providerContext.kvStore.get<string>(SEARCH_ENDPOINT_KEY);
    if (remembered) {
      endpoints = [remembered, ...endpoints.filter((e) => e !== remembered)];
    }
  } catch {
    /* kvStore unavailable */
  }

  const body = {
    page: Math.max(1, page),
    perPage: PAGE_SIZE,
    keyword: query,
    tabId: "",
  };

  for (const endpoint of endpoints) {
    try {
      const payload = await postJson(
        apiUrl(baseUrl, endpoint),
        body,
        providerContext,
        signal,
      );
      if (!payload || (payload.code !== undefined && payload.code !== 0)) {
        continue;
      }
      const posts = subjectsFromSearchPayload(payload.data ?? payload)
        .map(toPost)
        .filter((p): p is Post => Boolean(p));
      if (posts.length) {
        try {
          await providerContext.kvStore.set(SEARCH_ENDPOINT_KEY, endpoint);
        } catch {
          /* ignore */
        }
        return posts;
      }
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * Scrapes /newWeb/searchResult on a sibling MovieBox deployment. This is the
 * mechanism the reference movieBoxWeb provider uses and is the most reliable
 * path, since this domain itself has no search route.
 */
async function searchViaMirror({
  query,
  providerContext,
  signal,
}: {
  query: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  let hosts = [...SEARCH_HOSTS];
  try {
    const remembered =
      await providerContext.kvStore.get<string>(SEARCH_ORIGIN_KEY);
    if (remembered) {
      hosts = [remembered, ...hosts.filter((h) => h !== remembered)];
    }
  } catch {
    /* ignore */
  }

  for (const host of hosts) {
    for (const path of SEARCH_PATHS) {
      try {
        const html = await getHtml({
          url: `${host}${path}${encodeURIComponent(query)}`,
          providerContext,
          signal,
          referer: host + "/",
        });
        if (!html) continue;

        const posts: Post[] = [];
        const seen = new Set<string>();
        for (const subject of collectSubjects(
          parseNuxtData(html, providerContext.cheerio),
        )) {
          const post = toPost(subject);
          if (post && !seen.has(post.link)) {
            seen.add(post.link);
            posts.push(post);
          }
        }

        if (posts.length) {
          try {
            await providerContext.kvStore.set(SEARCH_ORIGIN_KEY, host);
          } catch {
            /* ignore */
          }
          return posts;
        }
      } catch {
        continue;
      }
    }
  }
  return [];
}

/**
 * Last resort: match locally against the trending feed. This only finds a
 * title if it happens to be trending, so it is a genuine fallback rather than
 * a guarantee of results.
 */
async function searchTrendingLocally({
  query,
  providerContext,
  signal,
}: {
  query: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const needle = query.toLowerCase();
  const seen = new Set<string>();
  const matches: Post[] = [];

  for (let page = 1; page <= 3; page++) {
    let batch: Post[] = [];
    try {
      batch = await fetchTrending({ page, providerContext, signal });
    } catch {
      break;
    }
    if (!batch.length) break;
    for (const post of batch) {
      if (seen.has(post.link)) continue;
      seen.add(post.link);
      if (post.title.toLowerCase().includes(needle)) matches.push(post);
    }
  }
  return matches;
}

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

    // 1) POST search API on this domain (if this build exposes one).
    const viaApi = await searchViaApi({ query, page, providerContext, signal });
    if (viaApi.length) return viaApi;

    if (page > 1) return [];

    // 2) Sibling MovieBox deployment that serves a real search page. Results
    //    are keyed by detailPath, which works against this domain's play API.
    const viaMirror = await searchViaMirror({ query, providerContext, signal });
    if (viaMirror.length) return viaMirror;

    // 3) Local match against trending. This only helps when the title happens
    //    to be trending, so it is a genuine last resort - not a guarantee.
    return await searchTrendingLocally({ query, providerContext, signal });
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
