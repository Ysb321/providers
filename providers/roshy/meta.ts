import { Info, Link, ProviderContext } from "../types";

// The intended non-adult movie/TV site's base URL. Keep blank until configured.
const defaultBaseUrl = "";

function cleanTitle(raw: string): string {
  return raw
    .replace(/Download\s*|Watch Online\s*/gi, "")
    .replace(/\s*[–|-]\s*.*$/g, "")
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toAbsolute(link: string, baseUrl: string): string {
  try {
    return new URL(link, baseUrl).href;
  } catch {
    return link;
  }
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const { axios, cheerio, commonHeaders, kvStore } = providerContext;
  const baseUrl =
    (await kvStore?.get<string>("baseUrlOverride")) || defaultBaseUrl;

  let title = "";
  let image = "";
  let synopsis = "";
  let imdbId = "";
  let isSeries = false;
  let url = "";
  const linkList: Link[] = [];

  try {
    url = new URL(link, baseUrl || "https://example.com").href;

    const response = await axios.get(url, {
      headers: {
        ...commonHeaders,
        Referer: `${baseUrl}/`,
      },
    });
    const $ = cheerio.load(response.data || "");

    const rawTitle =
      $("h1.page-title, h1.entry-title, .page-title h1, h1")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim() ||
      $("title").text().split("|")[0].trim();

    title = cleanTitle(rawTitle);

    image =
      $(".poster img, .single-poster img, .poster, .post-thumbnail img")
        .first()
        .attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      "";

    $(".entry-content p, .description, .synopsis p, .content p").each(
      (_, el) => {
        const text = $(el).text().trim();
        if (
          text &&
          !text.includes("IMDb Rating") &&
          !text.includes("Download") &&
          !text.includes("Screenshots") &&
          !synopsis
        ) {
          synopsis = text;
        }
      },
    );

    const imdbLink =
      $('a[href*="imdb.com/title/"]').first().attr("href") || "";
    const imdbMatch = imdbLink.match(/tt\d+/i) || response.data.match(/tt\d+/i);
    if (imdbMatch) imdbId = imdbMatch[0];

    isSeries =
      /\b(season\s*\d+|s\d+|complete\s+series|all\s+episodes|episode\s*\d+)\b/i.test(
        rawTitle,
      ) ||
      /-full-series-download|-season-\d+/i.test(url) ||
      /\/tv\//.test(url);

    if (isSeries) {
      const seasonMap: Record<
        string,
        { title: string; link: string; type?: "series" | "movie" }[]
      > = {};
      $(".ep-card, .episode-card, .season-episodes li, .episode-item").each(
        (_, epEl) => {
          const card = $(epEl);
          const seasonText =
            card.find(".season-number").text().trim() || "1";
          const seasonNum = seasonText.match(/\d+/)?.[0] || "1";
          const seasonName = `Season ${parseInt(seasonNum, 10)}`;

          const epBadge = card.find(".episode-badge, .ep-title").text().trim();
          const epNum = epBadge.match(/\d+/)?.[0];
          const epTitle = epNum
            ? `EPISODE ${parseInt(epNum, 10)}`
            : epBadge || "EPISODE 1";
          const epHref =
            card.find("a[href]").first().attr("href") ||
            card.attr("href") ||
            "";

          seasonMap[seasonName] ||= [];
          if (epHref) {
            seasonMap[seasonName].push({
              title: epTitle,
              link: toAbsolute(epHref, baseUrl),
              type: "series",
            });
          }
        },
      );

      for (const [seasonName, episodes] of Object.entries(seasonMap)) {
        episodes.sort((a, b) => {
          const nA = parseInt(a.title.replace(/\D+/g, "") || "0", 10);
          const nB = parseInt(b.title.replace(/\D+/g, "") || "0", 10);
          return nA - nB;
        });
        linkList.push({
          title: seasonName,
          directLinks: episodes,
        });
      }
    }

    if (linkList.length === 0) {
      const dlLinks: { title: string; link: string; type?: "movie" }[] = [];
      $(
        ".download-links a, .download-btn, a[href*='generate.php'], a.download",
      ).each((_, aEl) => {
        const href = $(aEl).attr("href");
        if (!href) return;
        dlLinks.push({
          title: "Movie",
          link: toAbsolute(href, baseUrl),
          type: "movie",
        });
      });
      if (dlLinks.length > 0) {
        linkList.push({
          title: "Download",
          directLinks: dlLinks,
        });
      }
    }

    return {
      title,
      synopsis,
      image,
      imdbId,
      type: isSeries ? "series" : "movie",
      linkList,
      webUrl: url,
    };
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error(`Roshy meta error: ${error?.message || error}`);
    return {
      title,
      synopsis: "",
      image: "",
      imdbId: "",
      type: "movie",
      linkList: [],
    };
  }
};
