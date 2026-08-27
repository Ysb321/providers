import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  OttCode,
  PROVIDER_NAME,
  SECTIONS,
  encodeToken,
  fetchApi,
  fetchPage,
  isOttCode,
  nowSeconds,
} from "./client";

/** `<ott>|<kind>[|<arg>]` - see catalog.ts. */
function parseFilter(filter: string): {
  ott: OttCode;
  kind: string;
  arg: string;
} {
  const parts = (filter || "").split("|");
  const ott = isOttCode(parts[0]) ? parts[0] : "nf";
  return { ott, kind: parts[1] || "home", arg: parts[2] || "" };
}

interface SearchHit {
  id?: string;
  t?: string;
  y?: string;
  r?: string;
}

function toPost(hit: SearchHit, ott: OttCode): Post | null {
  if (!hit?.id) return null;
  const section = SECTIONS[ott];
  // `r` is a runtime for movies ("2h 5m") and the literal "Series" for shows.
  const isSeries = /series/i.test(hit.r || "");
  return {
    title: hit.t || "",
    link: encodeToken({
      ott,
      id: hit.id,
      type: isSeries ? "series" : "movie",
      title: hit.t,
      year: hit.y,
    }),
    image: section.poster(hit.id),
  };
}

/**
 * Scrapes ids out of a rendered browse page. Posters are rebuilt from the id
 * rather than read from the markup because the site lazy-loads them behind
 * `data-src` placeholders that are often absent server-side.
 */
function collectFromHtml(
  html: string,
  ott: OttCode,
  providerContext: ProviderContext,
): Post[] {
  const { cheerio } = providerContext;
  const $ = cheerio.load(html || "");
  const section = SECTIONS[ott];
  const posts: Post[] = [];
  const seen = new Set<string>();

  const push = (id: string, title: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    posts.push({
      title: title || "",
      link: encodeToken({ ott, id, title: title || undefined }),
      image: section.poster(id),
    });
  };

  $("a.post-data, [data-post]").each((_, el) => {
    const node = $(el);
    const id = node.attr("data-post") || node.find("[data-post]").attr("data-post") || "";
    const title =
      node.attr("title") ||
      node.find("img").first().attr("alt") ||
      "";
    push(id.trim(), title.trim());
  });

  // Fallback: recover ids straight from poster URLs on skins that do not use
  // `data-post` (the Prime Video landing page is one of them).
  if (!posts.length) {
    const pattern =
      ott === "pv"
        ? /imgcdn\.[a-z]+\/pv\/\d+\/([A-Z0-9]{8,})\.jpg/gi
        : /imgcdn\.[a-z]+\/poster\/[a-z]\/(\d{6,})\.jpg/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) push(match[1], "");
  }

  return posts;
}

async function fetchHome({
  ott,
  providerContext,
  signal,
}: {
  ott: OttCode;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const section = SECTIONS[ott];
  for (const path of section.homePaths) {
    try {
      const html = await fetchPage({ path, ott, providerContext, signal });
      // Mobile UAs get an "install the app" wall on some paths - skip those.
      if (/Site Direct Access Not Allowed/i.test(html)) continue;
      const posts = collectFromHtml(html, ott, providerContext);
      if (posts.length) return posts;
    } catch (err) {
      console.log(`net77: ${path} unavailable:`, err);
    }
  }
  return [];
}

/**
 * The site has no numbered listing endpoint, but `search.php` accepts a single
 * letter and returns up to ~50 titles. Walking the alphabet gives a stable,
 * pageable browse view.
 */
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

async function fetchBrowse({
  ott,
  page,
  letter,
  providerContext,
  signal,
}: {
  ott: OttCode;
  page: number;
  letter: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Post[]> {
  const term = letter || LETTERS[(Math.max(1, page) - 1) % LETTERS.length];
  const section = SECTIONS[ott];
  const data = await fetchApi<{ searchResult?: SearchHit[] }>({
    path: `${section.prefix}/search.php?s=${encodeURIComponent(
      term,
    )}&t=${nowSeconds()}`,
    ott,
    providerContext,
    signal,
  });
  return (data?.searchResult || [])
    .map((hit) => toPost(hit, ott))
    .filter((p): p is Post => Boolean(p));
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
    const { ott, kind, arg } = parseFilter(filter);

    if (kind === "home") {
      // The landing page is a single fixed rail set - no pagination.
      if (page > 1) return [];
      const posts = await fetchHome({ ott, providerContext, signal });
      if (posts.length) return posts;
      // Home markup can be gated; fall back to the alphabetical browse.
      return await fetchBrowse({
        ott,
        page: 1,
        letter: "",
        providerContext,
        signal,
      });
    }

    if (page > LETTERS.length) return [];
    return await fetchBrowse({
      ott,
      page,
      letter: arg,
      providerContext,
      signal,
    });
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
    // search.php returns one unpaginated block.
    if (page > 1) return [];

    const query = (searchQuery || "").trim();
    if (!query) return [];

    // Query both catalogues so the user does not have to know which service
    // carries the title, then merge keeping the Netflix hit first.
    const sections: OttCode[] = ["nf", "pv"];
    const results = await Promise.all(
      sections.map(async (ott) => {
        try {
          const data = await fetchApi<{ searchResult?: SearchHit[] }>({
            path: `${SECTIONS[ott].prefix}/search.php?s=${encodeURIComponent(
              query,
            )}&t=${nowSeconds()}`,
            ott,
            providerContext,
            signal,
          });
          return (data?.searchResult || [])
            .map((hit) => toPost(hit, ott))
            .filter((p): p is Post => Boolean(p));
        } catch (err) {
          console.log(`net77: search failed for ${ott}:`, err);
          return [] as Post[];
        }
      }),
    );

    const merged: Post[] = [];
    const seen = new Set<string>();
    for (const list of results) {
      for (const post of list) {
        if (seen.has(post.link)) continue;
        seen.add(post.link);
        merged.push(post);
      }
    }
    return merged;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getSearchPosts", err);
  }
};
