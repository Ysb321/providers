import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  PROVIDER_NAME,
  encodeToken,
  getPage,
  getTmdb,
  posterUrl,
  titleOf,
  yearOf,
} from "./client";

interface TmdbItem {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
}

function parseFilter(filter: string): {
  media: string;
  kind: string;
  arg: string;
} {
  const parts = (filter || "").split("|");
  return {
    media: parts[0] || "all",
    kind: parts[1] || "trending",
    arg: parts[2] || "",
  };
}

function toPost(item: TmdbItem, fallbackMedia: string): Post | null {
  if (!item?.id) return null;

  // `media_type` is only present on /trending and /search/multi responses;
  // the list endpoints are already type-scoped. Anything explicitly typed as
  // something other than movie/tv (notably `person`, which /trending mixes in)
  // is dropped rather than coerced.
  let mediaType: "movie" | "tv";
  if (item.media_type === "tv" || item.media_type === "movie") {
    mediaType = item.media_type;
  } else if (item.media_type) {
    return null;
  } else {
    mediaType = fallbackMedia === "tv" ? "tv" : "movie";
  }

  const title = titleOf(item);
  if (!title) return null;

  return {
    title,
    link: encodeToken({
      tmdbId: String(item.id),
      type: mediaType,
      title,
      year: yearOf(item),
    }),
    image: posterUrl(item.poster_path || item.backdrop_path, "w500"),
  };
}

/** Maps a catalogue filter onto a path on the TMDB mirror. */
function buildPath(
  media: string,
  kind: string,
  arg: string,
  page: number,
): string {
  const p = Math.max(1, page);

  if (kind === "trending") {
    const scope = media === "movie" || media === "tv" ? media : "all";
    return `/trending/${scope}/day?page=${p}`;
  }

  const scope = media === "tv" ? "tv" : "movie";

  if (kind === "genre" && arg) {
    return (
      `/discover/${scope}?page=${p}&sort_by=popularity.desc` +
      `&with_genres=${encodeURIComponent(arg)}`
    );
  }

  const allowed =
    scope === "tv"
      ? ["popular", "top_rated", "airing_today", "on_the_air"]
      : ["popular", "top_rated", "now_playing", "upcoming"];
  const listName = allowed.indexOf(kind) >= 0 ? kind : "popular";
  return `/${scope}/${listName}?page=${p}`;
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
    const { media, kind, arg } = parseFilter(filter);
    const data = await getTmdb<{ results?: TmdbItem[] }>({
      path: buildPath(media, kind, arg, page),
      providerContext,
      signal,
    });

    const results = data?.results || [];
    const posts: Post[] = [];
    const seen = new Set<string>();

    for (const item of results) {
      const post = toPost(item, media);
      if (!post || seen.has(post.link)) continue;
      seen.add(post.link);
      posts.push(post);
    }
    return posts;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getPosts", err);
  }
};

/**
 * Scrapes `/browse?q=`, Redflix's own search page.
 *
 * Preferred over a raw TMDB query because Redflix only lists titles it can
 * actually play, so its result set is the honest one. Falls back to the TMDB
 * mirror if the page markup changes or the site is unreachable.
 */
async function searchViaSite({
  query,
  providerContext,
  signal,
}: {
  query: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const { cheerio } = providerContext;
  const html = await getPage({
    path: `/browse?q=${encodeURIComponent(query)}`,
    providerContext,
    signal,
  });
  if (!html) return [];

  const $ = cheerio.load(html);
  const posts: Post[] = [];
  const seen = new Set<string>();

  $('a[href*="/play?"]').each((_, el) => {
    const node = $(el);
    const href = node.attr("href") || "";
    const idMatch = /[?&]id=(\d+)/.exec(href);
    if (!idMatch) return;

    const tmdbId = idMatch[1];
    const type = /[?&]type=tv/.test(href) ? "tv" : "movie";
    const key = `${type}:${tmdbId}`;
    if (seen.has(key)) return;

    const img = node.find("img").first();
    const title = (
      node.attr("title") ||
      img.attr("alt") ||
      node.find("h2, h3").first().text() ||
      ""
    )
      .replace(/^(Poster|Still) for /i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) return;

    seen.add(key);
    posts.push({
      title,
      link: encodeToken({ tmdbId, type, title }),
      image: img.attr("src") || img.attr("data-src") || "",
    });
  });

  return posts;
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

    // The site's search page is a single unpaginated block.
    if (page === 1) {
      try {
        const siteResults = await searchViaSite({
          query,
          providerContext,
          signal,
        });
        if (siteResults.length) return siteResults;
      } catch (err) {
        console.log("redflix: site search unavailable, using TMDB:", err);
      }
    }

    const data = await getTmdb<{ results?: TmdbItem[] }>({
      path: `/search/multi?query=${encodeURIComponent(query)}&page=${Math.max(
        1,
        page,
      )}`,
      providerContext,
      signal,
    });

    const posts: Post[] = [];
    const seen = new Set<string>();
    for (const item of data?.results || []) {
      // /search/multi also returns people - they have no media_type we want.
      if (item.media_type !== "movie" && item.media_type !== "tv") continue;
      const post = toPost(item, item.media_type);
      if (!post || seen.has(post.link)) continue;
      seen.add(post.link);
      posts.push(post);
    }
    return posts;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
