import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { PROVIDER_NAME, absoluteUrl, fetchPage, getBaseUrl } from "./client";

/**
 * Listing pages render each title as an anchor to /movies/<slug>-<tmdbId> or
 * /series/<slug>-<tmdbId>, wrapping a poster image and the display title.
 */
function parseListing(
  html: string,
  baseUrl: string,
  providerContext: ProviderContext,
): Post[] {
  const $ = providerContext.cheerio.load(html || "");
  const posts: Post[] = [];
  const seen = new Set<string>();

  $("a[href*='/movies/'], a[href*='/series/']").each((_, el) => {
    const anchor = $(el);
    const href = anchor.attr("href") || "";
    if (!/\/(movies|series)\/[^/]+$/.test(href.split(/[?#]/)[0])) return;

    const link = absoluteUrl(href, baseUrl);
    if (seen.has(link)) return;

    const img = anchor.find("img").first();
    const title = (
      anchor.find("strong, b, h2, h3").first().text() ||
      img.attr("alt") ||
      anchor.attr("title") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (!title) return;

    seen.add(link);
    posts.push({
      title,
      link,
      image: absoluteUrl(
        img.attr("data-src") || img.attr("src") || "",
        baseUrl,
      ),
    });
  });

  return posts;
}

async function fetchListing({
  filter,
  page,
  providerContext,
  signal,
}: {
  filter: string;
  page: number;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const baseUrl = await getBaseUrl(providerContext);
  const params = new URLSearchParams();
  if (filter) params.set("type", filter);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  const url = query ? `${baseUrl}/?${query}` : `${baseUrl}/`;

  const html = await fetchPage({
    url,
    providerContext,
    signal,
    referer: baseUrl + "/",
  });
  return parseListing(html, baseUrl, providerContext);
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
    return await fetchListing({ filter, page, providerContext, signal });
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getPosts", err);
  }
};

/**
 * The site has no working server-side search: `?q=` and `?search=` both return
 * the unfiltered listing. It does hint that TMDB ids are searchable, and every
 * detail URL ends in the tmdb id, so a numeric query is matched against the
 * slug. Otherwise we page through listings and filter titles locally.
 */
const SEARCH_PARAMS = ["s", "q", "search", "keyword", "title"];
const SEARCH_PARAM_KEY = "xdMoviesSearchParam";
const MAX_SCAN_PAGES = 8;

function matches(title: string, needle: string): boolean {
  const haystack = title.toLowerCase();
  if (haystack.includes(needle)) return true;
  // every query word present (order-independent)
  const words = needle.split(/\s+/).filter((w) => w.length > 1);
  return words.length > 1 && words.every((w) => haystack.includes(w));
}

/** Tries server-side search params; returns [] unless one genuinely filters. */
async function searchViaSite({
  query,
  providerContext,
  signal,
}: {
  query: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const baseUrl = await getBaseUrl(providerContext);
  const needle = query.toLowerCase();

  let params = [...SEARCH_PARAMS];
  try {
    const remembered =
      await providerContext.kvStore.get<string>(SEARCH_PARAM_KEY);
    if (remembered) {
      params = [remembered, ...params.filter((p) => p !== remembered)];
    }
  } catch {
    /* ignore */
  }

  // Baseline: the unfiltered listing. If a param returns exactly this, it was
  // ignored by the server and must not be mistaken for a search result.
  let baseline: string[] = [];
  try {
    baseline = (
      await fetchListing({ filter: "", page: 1, providerContext, signal })
    ).map((p) => p.link);
  } catch {
    /* non-fatal */
  }

  for (const param of params) {
    try {
      const html = await fetchPage({
        url: `${baseUrl}/?${param}=${encodeURIComponent(query)}`,
        providerContext,
        signal,
        referer: baseUrl + "/",
      });
      const posts = parseListing(html, baseUrl, providerContext);
      if (!posts.length) continue;

      const sameAsBaseline =
        baseline.length === posts.length &&
        posts.every((p, i) => p.link === baseline[i]);
      if (sameAsBaseline) continue;

      const relevant = posts.filter((p) => matches(p.title, needle));
      if (relevant.length) {
        try {
          await providerContext.kvStore.set(SEARCH_PARAM_KEY, param);
        } catch {
          /* ignore */
        }
        return relevant;
      }
    } catch {
      continue;
    }
  }
  return [];
}

/** Pages through listings and filters locally - always works, just slower. */
async function searchByScanning({
  query,
  providerContext,
  signal,
}: {
  query: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const needle = query.toLowerCase();
  // A bare number is a TMDB id, which appears at the end of every detail URL.
  const tmdbId = /^\d{2,8}$/.test(query.trim()) ? query.trim() : "";

  const results: Post[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
    let batch: Post[] = [];
    try {
      batch = await fetchListing({ filter: "", page, providerContext, signal });
    } catch {
      break;
    }
    if (!batch.length) break;

    for (const post of batch) {
      if (seen.has(post.link)) continue;
      seen.add(post.link);
      const hit = tmdbId
        ? post.link.endsWith(`-${tmdbId}`)
        : matches(post.title, needle);
      if (hit) results.push(post);
    }
    if (tmdbId && results.length) break;
  }
  return results;
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
    if (!query || page > 1) return [];

    const viaSite = await searchViaSite({ query, providerContext, signal });
    if (viaSite.length) return viaSite;

    return await searchByScanning({ query, providerContext, signal });
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
