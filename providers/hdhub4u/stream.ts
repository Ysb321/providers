import { ProviderContext, Stream } from "../types";
import { throwProviderError } from "../providerErrors";
import { hubcloudExtractor } from "../extractors/hubcloud";
import { gdflixExtractor } from "../extractors/gdflix";
import { gofileExtractor } from "../extractors/gofile";
import {
  PROVIDER_NAME,
  absolutise,
  fetchPage,
  isFileHost,
  isPackLink,
  pageHeaders,
  qualityFromText,
} from "./client";

const HUBCLOUD_HOSTS = /(hubcloud|hubdrive|hubcdn|vcloud|driveleech|driveseed)/i;
const GDFLIX_HOSTS = /(gdflix|gdlink|gdtot)/i;

function hostPriority(url: string): number {
  if (/hubcloud/i.test(url)) return 0;
  if (HUBCLOUD_HOSTS.test(url)) return 1;
  if (GDFLIX_HOSTS.test(url)) return 2;
  if (/gofile\.io/i.test(url)) return 3;
  return 9;
}

/**
 * A `hubdrive.tips/file/<id>` page is a landing page, not the file itself - it
 * links out to the real `[HubCloud Server]` entry (verified live). Following
 * that first gives the hubcloud extractor the page shape it expects.
 */
async function unwrapHubdrive({
  url,
  providerContext,
  signal,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<string> {
  if (!/hubdrive/i.test(url)) return url;
  try {
    const { cheerio } = providerContext;
    const { html, baseUrl } = await fetchPage({
      absoluteUrl: url,
      providerContext,
      signal,
    });
    const $ = cheerio.load(html || "");
    let found = "";
    $("a[href]").each((_, el) => {
      if (found) return;
      const href = $(el).attr("href") || "";
      if (/hubcloud\.[a-z]+\/drive\//i.test(href)) found = absolutise(href, baseUrl);
    });
    return found || url;
  } catch (err) {
    console.log(`hdhub4u: could not unwrap ${url}:`, err);
    return url;
  }
}

async function resolveHost({
  url,
  providerContext,
  signal,
  isDownload,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
  isDownload?: boolean;
}): Promise<Stream[]> {
  const { axios, cheerio, commonHeaders } = providerContext;
  const headers = { ...pageHeaders, ...(commonHeaders || {}) };

  try {
    if (HUBCLOUD_HOSTS.test(url)) {
      const target = await unwrapHubdrive({ url, providerContext, signal });
      return (
        (await hubcloudExtractor(
          target,
          signal as AbortSignal,
          axios,
          cheerio,
          headers,
          providerContext,
          isDownload,
          PROVIDER_NAME,
        )) || []
      );
    }
    if (GDFLIX_HOSTS.test(url)) {
      return (
        (await gdflixExtractor(
          url,
          signal as AbortSignal,
          axios,
          cheerio,
          headers,
          providerContext,
        )) || []
      );
    }
    if (/gofile\.io/i.test(url)) {
      // gofileExtractor takes the content id, not the page url, and returns a
      // single link plus the account token the CDN wants back as a cookie.
      const contentId = url.split("/").filter(Boolean).pop() || "";
      if (!contentId) return [];
      const gf = await gofileExtractor(contentId, axios, providerContext);
      if (!gf?.link) return [];
      return [
        {
          server: "Gofile",
          link: gf.link,
          type: "mkv",
          headers: {
            Referer: "https://gofile.io/",
            Cookie: `accountToken=${gf.token}`,
            "User-Agent": headers["User-Agent"],
          },
        },
      ];
    }
  } catch (err) {
    console.log(`hdhub4u: ${url} failed to resolve:`, err);
  }
  return [];
}

/** Expands a post page into the file-host links it holds. */
async function collectFileHosts({
  url,
  providerContext,
  signal,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { cheerio } = providerContext;
  const { html, baseUrl } = await fetchPage({
    absoluteUrl: /^https?:\/\//i.test(url) ? url : undefined,
    path: /^https?:\/\//i.test(url) ? undefined : url,
    providerContext,
    signal,
  });

  const $ = cheerio.load(html || "");
  const found: string[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || !isFileHost(href)) return;
    const link = absolutise(href, baseUrl);
    if (seen.has(link)) return;
    if (isPackLink($(el).text(), link)) return;
    seen.add(link);
    found.push(link);
  });

  return found.sort((a, b) => hostPriority(a) - hostPriority(b));
}

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  try {
    if (!link) throw new Error("no link supplied");

    // meta.ts normally hands us a file host directly; tolerate a post page.
    const targets = isFileHost(link)
      ? [link]
      : await collectFileHosts({ url: link, providerContext, signal });

    if (!targets.length) {
      throw new Error(`no supported file host found for ${link}`);
    }

    let streams: Stream[] = [];
    for (const target of targets) {
      streams = streams.concat(
        await resolveHost({ url: target, providerContext, signal, isDownload }),
      );
      if (streams.length) break;
    }

    const seen = new Set<string>();
    streams = streams.filter((s) => {
      if (!s?.link || !/^https?:\/\//i.test(s.link)) return false;
      if (seen.has(s.link)) return false;
      seen.add(s.link);
      return true;
    });

    if (!streams.length) {
      throw new Error(
        "every file host for this title failed to resolve - the links may " +
          "have expired, or the host is blocked on your network",
      );
    }

    streams = streams.map((s) => ({
      ...s,
      quality: s.quality || qualityFromText(`${s.server} ${s.link}`),
    }));

    const rank = (s: Stream) => Number(s.quality || 0);
    if (isDownload) {
      streams.sort((a, b) => {
        const d = (b.type === "mp4" ? 1 : 0) - (a.type === "mp4" ? 1 : 0);
        return d !== 0 ? d : rank(b) - rank(a);
      });
    } else {
      streams.sort((a, b) => rank(b) - rank(a));
    }

    return streams;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getStream", err);
  }
};
