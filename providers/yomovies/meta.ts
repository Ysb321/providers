import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { absoluteUrl, fetchPage, getBaseUrl, PROVIDER_NAME } from "./client";
import { isSeriesTitle } from "./utils";

type DirectLink = {
  title: string;
  link: string;
  type: "movie" | "series";
};

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const { cheerio } = providerContext;

  try {
    const baseUrl = await getBaseUrl(providerContext);
    const html = await fetchPage({
      url: link,
      providerContext,
      referer: baseUrl + "/",
    });
    const $ = cheerio.load(html || "");

    // ---------------- metadata ----------------
    const title = (
      $(".mvic-desc h3").first().text() ||
      $("h3[itemprop='name']").first().text() ||
      $(".thumb.mvic-thumb").attr("title") ||
      $("meta[property='og:title']").attr("content") ||
      $("h1").first().text() ||
      ""
    )
      .replace(/\s*(Download full Movie.*|Watch Online.*)$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    const synopsis = (
      $(".mvic-desc .desc").first().text() ||
      $(".desc").first().text() ||
      $("meta[property='og:description']").attr("content") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();

    const image = absoluteUrl(
      $(".mvic-thumb img").attr("src") ||
        $(".thumb img").attr("src") ||
        $("meta[property='og:image']").attr("content") ||
        $("img[itemprop='image']").attr("src") ||
        "",
      baseUrl,
    );

    const coverStyle = $(".mvi-cover").attr("style") || "";
    const coverMatch = coverStyle.match(/url\((['"]?)(.*?)\1\)/);
    const poster = coverMatch ? absoluteUrl(coverMatch[2], baseUrl) : image;

    const imdbMatch = html.match(/tt\d{7,10}/);
    const imdbId = imdbMatch ? imdbMatch[0] : "";

    const tags: string[] = [];
    $("a[href*='/genre/']").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t && !tags.includes(t)) tags.push(t);
    });

    const cast: string[] = [];
    $("a[href*='/stars/']").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t && !cast.includes(t)) cast.push(t);
    });

    const ratingMatch = $(".mvic-info, .mvici-left, .mvici-right, body")
      .first()
      .text()
      .match(/IMDb:\s*([\d.]+)/i);
    const rating = ratingMatch ? ratingMatch[1] : "";

    const type = isSeriesTitle(title) ? "series" : "movie";

    // ---------------- playable sources ----------------
    const seen = new Set<string>();
    const embeds: DirectLink[] = [];
    const downloads: DirectLink[] = [];

    const add = (
      bucket: DirectLink[],
      rawUrl: string,
      label: string,
    ): void => {
      const url = absoluteUrl(rawUrl, baseUrl);
      if (!url || seen.has(url)) return;
      if (
        /(google|gstatic|facebook|twitter|disqus|sharethis|youtube\.com|\.(?:png|jpe?g|gif|svg|css|js)(?:\?|$))/i.test(
          url,
        )
      )
        return;
      seen.add(url);
      bucket.push({
        title: label,
        link: url,
        type: type === "series" ? "series" : "movie",
      });
    };

    // 1) Player tabs. Each tab holds an iframe (sometimes lazily in data-src)
    //    and the sidebar lists them as "Server 1 / HD 1080p".
    const tabLabels: string[] = [];
    $("#mv-info .idTabs li, .les-title li, ul.idTabs li").each((_, el) => {
      const label = $(el).text().replace(/\s+/g, " ").trim();
      if (label) tabLabels.push(label);
    });

    let embedIndex = 0;
    $(
      "#mv-info iframe, .movieplay iframe, .les-content iframe, #player iframe, iframe[src], iframe[data-src]",
    ).each((_, el) => {
      const src =
        $(el).attr("src") ||
        $(el).attr("data-src") ||
        $(el).attr("data-lazy-src") ||
        "";
      if (!src) return;
      const label = tabLabels[embedIndex] || `Server ${embedIndex + 1}`;
      embedIndex += 1;
      add(embeds, src, label);
    });

    // Some skins keep the embed url in a data attribute on the tab itself.
    $("[data-video], [data-embed], [data-putload], li[data-server]").each(
      (_, el) => {
        const src =
          $(el).attr("data-video") ||
          $(el).attr("data-embed") ||
          $(el).attr("data-putload") ||
          "";
        if (!src) return;
        const label =
          $(el).text().replace(/\s+/g, " ").trim() ||
          `Server ${embedIndex + 1}`;
        embedIndex += 1;
        add(embeds, src, label);
      },
    );

    // 2) Download table rows (#list-dl) - speedostream & friends.
    $("#list-dl a[href], .mvic-dl a[href], table a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (!/^https?:\/\//i.test(href)) return;
      if (href.includes(new URL(baseUrl).host)) return;

      const rowText = $(el).text().replace(/\s+/g, " ").trim();
      const q =
        (rowText.match(/(2160p|1080p|720p|480p|360p)/i) || [])[1] ||
        (rowText.match(/\b(HD|SD)\b/i) || [])[1] ||
        "";
      add(downloads, href, q ? `Download ${q.toUpperCase()}` : "Download");
    });

    const directLinks = [...embeds, ...downloads];

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
        const q = (title.match(/(2160p|1080p|720p|480p)/i) || [])[1];
        linkList.push({
          title: "Movie",
          quality: q ? q.toLowerCase() : undefined,
          directLinks,
        });
      }
    }

    return {
      title,
      synopsis,
      image,
      poster,
      imdbId,
      type,
      tags,
      cast: cast.slice(0, 15),
      rating: rating || undefined,
      linkList,
      webUrl: link,
    };
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getMeta", err);
  }
};
