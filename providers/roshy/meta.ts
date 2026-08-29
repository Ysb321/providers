import { Info, Link, ProviderContext } from "../types";
import { getBaseUrl } from "../getBaseUrl";
import { throwProviderError } from "../providerErrors";

const providerValue = "roshy";
// Leave empty so the template does not accidentally scrape the adult domain.
// Set this (or the url in urls.json) to your intended non-adult site before use.
const defaultBaseUrl = "";

function cleanTitle(raw: string, baseUrl: string): string {
  return raw
    .replace(/Download\s*|Watch Online\s*/gi, "")
    .replace(/\s*[–|-]\s*(Roshy.*)?$/i, "")
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getMeta({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const { axios, cheerio, commonHeaders } = providerContext;
    const baseUrl = (await getBaseUrl(providerValue)) || defaultBaseUrl;
    const url = new URL(link, baseUrl).href;

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

    const title = cleanTitle(rawTitle, baseUrl);

    const image =
      $(".poster img, .single-poster img, .poster, .post-thumbnail img, .entry-content img")
        .first()
        .attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      "";

    let synopsis = "";
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

    // IMDb ID if the page links out to IMDb.
    let imdbId = "";
    const imdbLink =
      $('a[href*="imdb.com/title/"]').first().attr("href") || "";
    const imdbMatch = imdbLink.match(/tt\d+/i) || response.data.match(/tt\d+/i);
    if (imdbMatch) imdbId = imdbMatch[0];

    const isSeries =
      /\b(season\s*\d+|s\d+|complete\s+series|all\s+episodes|episode\s*\d+)\b/i.test(
        rawTitle,
      ) ||
      /-full-series-download|-season-\d+/i.test(url) ||
      /\/tv\//.test(url);

    const linkList: Link[] = [];

    // Episodes grouped by season / quality, common on these themes.
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

    // Fallback: movie download links container.
    if (linkList.length === 0) {
      const dlLinks: { title: string; link: string; type?: "movie" }[] = [];
      $(".download-links a, .download-btn, a[href*='generate.php'], a.download").each(
        (_, aEl) => {
          const href = $(aEl).attr("href");
          if (!href) return;
          dlLinks.push({
            title: "Movie",
            link: toAbsolute(href, baseUrl),
            type: "movie",
          });
        },
      );
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
  } catch (err) {
    throwProviderError("Roshy", "metadata", err);
  }
}

function toAbsolute(link: string, baseUrl: string): string {
  try {
    return new URL(link, baseUrl).href;
  } catch {
    return link;
  }
}
