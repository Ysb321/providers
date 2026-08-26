import { Post, ProviderContext } from "../types";
import { absoluteUrl, getBaseUrl, yoHeaders } from "./utils";

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
  const { axios, cheerio } = providerContext;
  const baseUrl = await getBaseUrl(providerContext);

  const cleanPath = (path || "").replace(/^\/+/, "").replace(/\/+$/, "");
  let url = cleanPath ? `${baseUrl}/${cleanPath}/` : `${baseUrl}/`;
  if (page && page > 1) {
    url = cleanPath
      ? `${baseUrl}/${cleanPath}/page/${page}/`
      : `${baseUrl}/page/${page}/`;
  }

  const res = await axios.get(url, {
    headers: { ...yoHeaders, Referer: baseUrl + "/" },
    signal,
  });

  const $ = cheerio.load(res.data || "");
  const posts: Post[] = [];
  const seen = new Set<string>();

  $(".ml-item").each((_, el) => {
    const item = $(el);
    const anchor = item.find("a").first();
    const href = anchor.attr("href") || "";
    if (!href) return;

    const link = absoluteUrl(href, baseUrl);
    if (seen.has(link)) return;

    const title =
      (anchor.attr("title") || "").trim() ||
      item.find("h2").first().text().trim() ||
      item.find(".mli-info h2").text().trim();
    if (!title) return;

    const img = item.find("img").first();
    const image = absoluteUrl(
      img.attr("data-original") ||
        img.attr("data-src") ||
        img.attr("src") ||
        "",
      baseUrl,
    );

    seen.add(link);
    posts.push({ title, link, image });
  });

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
    return await fetchPosts({
      path: filter,
      page,
      signal,
      providerContext,
    });
  } catch (err) {
    console.error("yomovies getPosts error:", err);
    return [];
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
    const query = encodeURIComponent((searchQuery || "").trim());
    if (!query) return [];
    return await fetchPosts({
      path: `search/${query}`,
      page,
      signal,
      providerContext,
    });
  } catch (err) {
    console.error("yomovies getSearchPosts error:", err);
    return [];
  }
};
