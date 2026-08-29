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

/**
 * Collects posts from a listing page.
 *
 * The markup for one entry is a list item holding **two** anchors to the same
 * permalink: an image-only one (whose own text is empty) and a text one
 * carrying the title:
 *
 *   <li>
 *     <a href="/slug/"><img src="poster.jpg" alt="Title ..."></a>
 *     <a href="/slug/">Title (2026) WEB-DL [Hindi] ...</a>
 *   </li>
 *
 * So the permalink is the reliable key: group every anchor by its target and
 * merge the poster and the title from whichever sibling supplied each. Keying
 * off the image and hoping the *first* anchor in the container carried the
 * title is what previously returned nothing on pages where the image-only
 * anchor comes first.
 */
function collect(
  html: string,
  baseUrl: string,
  providerContext: ProviderContext,
): Post[] {
  const { cheerio } = providerContext;
  const $ = cheerio.load(html || "");

  const byLink = new Map<string, { title: string; image: string }>();
  const order: string[] = [];

  $("a[href]").each((_, el) => {
    const anchor = $(el);
    const href = anchor.attr("href") || "";
    if (!href || IGNORE_HREF.test(href)) return;

    const relative = toRelativePath(href, baseUrl);
    // Post permalinks are exactly one slug deep off the site root.
    if (!/^\/[^/]+\/?$/.test(relative)) return;

    // The poster is NOT inside the anchor. A listing entry is three siblings:
    //   <img src="poster.jpg" alt="Title">   <a href="/slug/"></a>   <a href="/slug/">Title</a>
    // so look inside the anchor first (other skins do nest it), then fall back
    // to the nearest image in the surrounding list item.
    let img = anchor.find("img").first();
    if (!img.length) {
      const container = anchor.closest("li, article, figure, .post, .item");
      img = (container.length ? container : anchor.parent())
        .find("img")
        .first();
    }
    const image =
      img.attr("src") || img.attr("data-src") || img.attr("data-lazy-src") || "";

    // The anchor's own text, or the image alt when this is the image-only one.
    const title = cleanTitle(
      anchor.text().replace(/\s+/g, " ").trim() ||
        img.attr("alt") ||
        anchor.attr("title") ||
        "",
    );

    if (!byLink.has(relative)) {
      byLink.set(relative, { title: "", image: "" });
      order.push(relative);
    }
    const entry = byLink.get(relative)!;

    // Prefer a real poster; ignore site chrome (banners, logos, share icons).
    if (
      !entry.image &&
      image &&
      !/whatsapp|telegram|banner|logo|sharethis|\.svg(\?|$)/i.test(image)
    ) {
      entry.image = image;
    }
    // Prefer the longest title seen - the text anchor is more descriptive
    // than a truncated alt attribute.
    if (title && title.length > entry.title.length) entry.title = title;
  });

  const posts: Post[] = [];
  for (const relative of order) {
    const entry = byLink.get(relative)!;
    // A real listing entry always has a poster; nav links never do. This is
    // what keeps footer/menu links out without needing a slug blocklist.
    if (!entry.title || !entry.image) continue;
    posts.push({ title: entry.title, link: relative, image: entry.image });
  }

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
