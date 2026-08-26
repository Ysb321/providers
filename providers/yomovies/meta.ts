import { Info, Link, ProviderContext } from "../types";
import { absoluteUrl, getBaseUrl, isSeriesTitle, yoHeaders } from "./utils";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const { axios, cheerio } = providerContext;
  const baseUrl = await getBaseUrl(providerContext);

  const empty: Info = {
    title: "",
    synopsis: "",
    image: "",
    imdbId: "",
    type: "movie",
    linkList: [],
  };

  try {
    const res = await axios.get(link, {
      headers: { ...yoHeaders, Referer: baseUrl + "/" },
    });
    const $ = cheerio.load(res.data || "");

    // ---------- basic metadata ----------
    const title =
      $(".mvic-desc h3").first().text().trim() ||
      $("h3[itemprop='name']").first().text().trim() ||
      $(".thumb.mvic-thumb").attr("title")?.trim() ||
      $("meta[property='og:title']").attr("content")?.trim() ||
      $("title").text().split("Download")[0].trim();

    const synopsis =
      $(".desc").first().text().trim() ||
      $("meta[property='og:description']").attr("content")?.trim() ||
      "";

    let image =
      $(".mvic-desc .thumb img").attr("src") ||
      $(".mvi-cover img").attr("src") ||
      $("meta[property='og:image']").attr("content") ||
      $("img[itemprop='image']").attr("src") ||
      "";
    image = absoluteUrl(image, baseUrl);

    // background thumb (poster)
    let poster = $(".mvi-cover").attr("style") || "";
    const posterMatch = poster.match(/url\((['"]?)(.*?)\1\)/);
    poster = posterMatch ? absoluteUrl(posterMatch[2], baseUrl) : "";

    // imdb id
    let imdbId = "";
    const imdbHref =
      $("a[href*='imdb.com/title/']").attr("href") ||
      $("[data-imdb]").attr("data-imdb") ||
      "";
    const imdbMatch = (imdbHref + " " + (res.data || "")).match(/tt\d{6,10}/);
    if (imdbMatch) imdbId = imdbMatch[0];

    const tags: string[] = [];
    $("a[href*='/genre/']").each((_, el) => {
      const t = $(el).text().trim();
      if (t && !tags.includes(t)) tags.push(t);
    });

    const cast: string[] = [];
    $("a[href*='/stars/']").each((_, el) => {
      const t = $(el).text().trim();
      if (t && !cast.includes(t)) cast.push(t);
    });

    const rating =
      $(".mvici-right .imdb-r span").first().text().trim() ||
      ($(".mvic-info, .mvici-left, .mvici-right").text().match(
        /IMDb:\s*([\d.]+)/i,
      ) || [])[1] ||
      "";

    const type = isSeriesTitle(title) ? "series" : "movie";

    // ---------- media links ----------
    const seen = new Set<string>();
    const directLinks: {
      title: string;
      link: string;
      type: "movie" | "series";
    }[] = [];

    const addLink = (rawUrl: string, label: string) => {
      const url = absoluteUrl(rawUrl, baseUrl);
      if (!url || seen.has(url)) return;
      // ignore junk iframes
      if (/(google|facebook|twitter|disqus|youtube\.com\/embed\/)/i.test(url))
        return;
      seen.add(url);
      directLinks.push({
        title: label,
        link: url,
        type: type === "series" ? "series" : "movie",
      });
    };

    // 1) Player tabs / iframes -> embed servers
    let serverIndex = 0;
    $("#mv-info iframe, .movieplay iframe, .les-content iframe, iframe").each(
      (_, el) => {
        const src =
          $(el).attr("src") ||
          $(el).attr("data-src") ||
          $(el).attr("data-lazy-src") ||
          "";
        if (!src) return;
        serverIndex += 1;
        addLink(src, `Server ${serverIndex}`);
      },
    );

    // Some tabs keep the embed url in a data attribute instead of an iframe
    $("[data-video], [data-src][class*='server'], a[data-embed]").each(
      (_, el) => {
        const src =
          $(el).attr("data-video") ||
          $(el).attr("data-src") ||
          $(el).attr("data-embed") ||
          "";
        if (!src) return;
        serverIndex += 1;
        addLink(src, `Server ${serverIndex}`);
      },
    );

    // 2) Download table rows (speedostream & friends)
    $("#list-dl a, .dlbtn a, table a, .mvic-dl a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (!href || href.startsWith("#") || href.includes(baseUrl)) return;
      if (!/^https?:\/\//i.test(href)) return;
      const rowText = $(el).text().replace(/\s+/g, " ").trim();
      const qualityMatch =
        rowText.match(/(2160p|1080p|720p|480p|360p)/i) ||
        rowText.match(/\b(HD|SD)\b/i);
      const label = qualityMatch
        ? `Download ${qualityMatch[1].toUpperCase()}`
        : rowText || "Download";
      addLink(href, label);
    });

    const linkList: Link[] = [];

    if (directLinks.length) {
      if (type === "series") {
        linkList.push({
          title: title || "Episodes",
          directLinks: directLinks.map((d, i) => ({
            ...d,
            title: d.title || `Episode ${i + 1}`,
          })),
        });
      } else {
        linkList.push({
          title: "Movie",
          quality:
            (title.match(/(2160p|1080p|720p|480p)/i) || [])[1] || undefined,
          directLinks,
        });
      }
    }

    return {
      title: title || "",
      synopsis,
      image,
      poster: poster || image,
      imdbId,
      type,
      tags,
      cast: cast.slice(0, 15),
      rating: rating || undefined,
      linkList,
      webUrl: link,
    };
  } catch (err) {
    console.error("yomovies getMeta error:", err);
    return empty;
  }
};
