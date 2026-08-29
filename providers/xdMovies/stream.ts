import { ProviderContext, Stream } from "../types";
import { throwProviderError } from "../providerErrors";
import { hubcloudExtractor } from "../extractors/hubcloud";
import { gdflixExtractor } from "../extractors/gdflix";
import { gofileExtractor } from "../extractors/gofile";
import {
  PROVIDER_NAME,
  fetchPage,
  getBaseUrl,
  qualityOf,
  xdHeaders,
} from "./client";

const HUBCLOUD_HOSTS = /(hubcloud|hubdrive|vcloud|driveleech|driveseed)/i;
const GDFLIX_HOSTS = /(gdflix|gdlink|gdtot)/i;
const FILEPRESS_HOSTS = /(filepress|filebee)/i;
/** The site's own shortener - it fronts a Cloudflare Turnstile gate. */
const XD_LINK_HOSTS = /link\.xdmovies\./i;

/**
 * HubCloud rotates domains and is widely DNS-blocked by Indian ISPs; retrying
 * the same path on a sibling domain recovers from both cases.
 */
const HUBCLOUD_MIRRORS = [
  "hubcloud.one",
  "hubcloud.art",
  "hubcloud.cx",
  "hubcloud.dad",
  "hubcloud.foo",
  "hubcloud.bz",
];

export const nonStreamableServer = ["G-Drive (download only)", "Gofile"];

function isPlayable(stream: Stream): boolean {
  const server = (stream.server || "").toLowerCase();
  if (nonStreamableServer.some((s) => server === s.toLowerCase())) return false;
  return !/download only/i.test(stream.server || "");
}

/** True when the request never reached a server (DNS/TLS/timeout). */
function isNetworkError(err: any): boolean {
  if (err?.response) return false;
  const msg = String(err?.message || err || "");
  return /network error|timeout|timedout|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ECONNABORTED|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|certificate|socket hang up|getaddrinfo/i.test(
    msg,
  );
}

function mirrorCandidates(url: string, preferred?: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return [url];
  }
  if (preferred) {
    const clean = preferred.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (clean) push(url.replace(host, clean));
  }
  push(url);
  if (/hubcloud/i.test(host)) {
    for (const m of HUBCLOUD_MIRRORS) if (m !== host) push(url.replace(host, m));
  }
  return out;
}

type Resolved = { streams: Stream[]; reached: boolean };

async function viaHubcloud({
  url,
  providerContext,
  signal,
  isDownload,
  preferredDomain,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
  isDownload?: boolean;
  preferredDomain?: string;
}): Promise<Resolved> {
  const { axios, cheerio } = providerContext;
  let reached = false;

  for (const candidate of mirrorCandidates(url, preferredDomain)) {
    try {
      const result = await hubcloudExtractor(
        candidate,
        signal as AbortSignal,
        axios,
        cheerio,
        { ...xdHeaders },
        providerContext,
        isDownload,
        PROVIDER_NAME,
      );
      reached = true;
      const streams = Array.isArray(result) ? (result as Stream[]) : [];
      if (streams.length) return { streams, reached };
      break; // answered but empty - siblings serve the same id
    } catch (err) {
      const cause = (err as any)?.cause ?? err;
      if (!isNetworkError(err) && !isNetworkError(cause)) {
        reached = true;
        break;
      }
      console.log(`xdMovies: ${candidate} unreachable, trying next mirror`);
    }
  }
  return { streams: [], reached };
}

async function viaGdflix({
  url,
  providerContext,
  signal,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Resolved> {
  const { axios, cheerio } = providerContext;
  try {
    const result = await gdflixExtractor(
      url,
      signal as AbortSignal,
      axios,
      cheerio,
      { ...xdHeaders },
      providerContext,
    );
    return {
      streams: Array.isArray(result) ? (result as Stream[]) : [],
      reached: true,
    };
  } catch (err) {
    const cause = (err as any)?.cause ?? err;
    return {
      streams: [],
      reached: !isNetworkError(err) && !isNetworkError(cause),
    };
  }
}

async function viaGofile({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<Resolved> {
  try {
    const id = url.split("/").filter(Boolean).pop() || "";
    if (!id) return { streams: [], reached: false };
    const gf = await gofileExtractor(id, providerContext.axios, providerContext);
    if (!gf?.link) return { streams: [], reached: true };
    return {
      reached: true,
      streams: [
        {
          server: "Gofile",
          link: gf.link,
          type: "mkv",
          headers: {
            Referer: "https://gofile.io/",
            Cookie: `accountToken=${gf.token}`,
          },
        },
      ],
    };
  } catch {
    return { streams: [], reached: false };
  }
}

/**
 * The site's own link.xdmovies.wtf shortener redirects to a Cloudflare
 * Turnstile page with a countdown, so it cannot be resolved with plain HTTP.
 * The app WebView can clear it; whatever real file-host URL appears afterwards
 * is then handed to the matching extractor.
 */
async function viaXdLink({
  url,
  providerContext,
  signal,
  isDownload,
  preferredDomain,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
  isDownload?: boolean;
  preferredDomain?: string;
}): Promise<Resolved> {
  const { cheerio, openWebView } = providerContext;
  if (typeof openWebView !== "function") return { streams: [], reached: false };

  try {
    const result = await openWebView(url, {
      title: "Generating XDMovies link",
      description:
        "Complete the verification and wait for the download link to appear.",
      headers: { ...xdHeaders },
      timeoutMs: 120000,
    });

    const html = result?.data || "";
    const finalUrl = result?.url || url;

    // The gate may land directly on a file host.
    if (!XD_LINK_HOSTS.test(finalUrl) && /^https?:\/\//i.test(finalUrl)) {
      return await dispatch({
        url: finalUrl,
        providerContext,
        signal,
        isDownload,
        preferredDomain,
      });
    }

    // Otherwise pull any known host out of the rendered page.
    const $ = cheerio.load(html);
    const candidates: string[] = [];
    $("a[href]").each((_: unknown, el: any) => {
      const href = ($(el).attr("href") || "").trim();
      if (
        /^https?:\/\//i.test(href) &&
        (HUBCLOUD_HOSTS.test(href) ||
          GDFLIX_HOSTS.test(href) ||
          /gofile\.io/i.test(href) ||
          FILEPRESS_HOSTS.test(href))
      ) {
        candidates.push(href);
      }
    });

    for (const candidate of Array.from(new Set(candidates))) {
      const out = await dispatch({
        url: candidate,
        providerContext,
        signal,
        isDownload,
        preferredDomain,
      });
      if (out.streams.length) return out;
    }

    // A direct media URL is also a valid outcome.
    const direct = html.match(
      /https?:\/\/[^"'\s]+\.(?:mkv|mp4)(?:\?[^"'\s]*)?/i,
    )?.[0];
    if (direct) {
      return {
        reached: true,
        streams: [
          {
            server: "XDMovies",
            link: direct,
            type: /\.mp4/i.test(direct) ? "mp4" : "mkv",
            quality: qualityOf(direct) as Stream["quality"],
            headers: { Referer: finalUrl },
          },
        ],
      };
    }

    return { streams: [], reached: true };
  } catch (err) {
    console.log("xdMovies: link gate failed for", url, err);
    return { streams: [], reached: false };
  }
}

async function dispatch({
  url,
  providerContext,
  signal,
  isDownload,
  preferredDomain,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
  isDownload?: boolean;
  preferredDomain?: string;
}): Promise<Resolved> {
  if (HUBCLOUD_HOSTS.test(url)) {
    return viaHubcloud({
      url,
      providerContext,
      signal,
      isDownload,
      preferredDomain,
    });
  }
  if (GDFLIX_HOSTS.test(url)) {
    return viaGdflix({ url, providerContext, signal });
  }
  if (/gofile\.io/i.test(url)) {
    return viaGofile({ url, providerContext });
  }
  if (XD_LINK_HOSTS.test(url)) {
    return viaXdLink({
      url,
      providerContext,
      signal,
      isDownload,
      preferredDomain,
    });
  }
  // FilePress-style wrapper: follow it and retry whatever it points at.
  if (FILEPRESS_HOSTS.test(url)) {
    try {
      const html = await fetchPage({ url, providerContext, signal });
      const $ = providerContext.cheerio.load(html || "");
      let nested = "";
      $("a[href]").each((_: unknown, el: any) => {
        const href = ($(el).attr("href") || "").trim();
        if (
          !nested &&
          (HUBCLOUD_HOSTS.test(href) ||
            GDFLIX_HOSTS.test(href) ||
            /gofile\.io/i.test(href))
        ) {
          nested = href;
        }
      });
      if (nested) {
        return dispatch({
          url: nested,
          providerContext,
          signal,
          isDownload,
          preferredDomain,
        });
      }
      return { streams: [], reached: true };
    } catch {
      return { streams: [], reached: false };
    }
  }
  return { streams: [], reached: false };
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
  const { cheerio } = providerContext;

  try {
    const baseUrl = await getBaseUrl(providerContext);
    let preferredDomain = "";
    try {
      preferredDomain =
        (await providerContext.kvStore.get<string>("xdMoviesHubcloudDomain")) ||
        "";
    } catch {
      /* ignore */
    }

    // meta hands us a file-host URL, but tolerate a detail page too.
    let targets = [link];
    if (link.includes(new URL(baseUrl).host) && /\/(movies|series)\//.test(link)) {
      const html = await fetchPage({
        url: link,
        providerContext,
        signal,
        referer: baseUrl + "/",
      });
      const $ = cheerio.load(html || "");
      const found: string[] = [];
      $("a[href]").each((_, el) => {
        const href = ($(el).attr("href") || "").trim();
        if (
          /^https?:\/\//i.test(href) &&
          (HUBCLOUD_HOSTS.test(href) ||
            GDFLIX_HOSTS.test(href) ||
            /gofile\.io/i.test(href) ||
            XD_LINK_HOSTS.test(href))
        ) {
          found.push(href);
        }
      });
      if (!found.length) return [];
      // Prefer hosts resolvable without the Turnstile gate.
      found.sort(
        (a, b) =>
          (XD_LINK_HOSTS.test(a) ? 1 : 0) - (XD_LINK_HOSTS.test(b) ? 1 : 0),
      );
      targets = found;
    }

    let streams: Stream[] = [];
    let reachedAny = false;

    for (const target of targets) {
      const out = await dispatch({
        url: target,
        providerContext,
        signal,
        isDownload,
        preferredDomain,
      });
      if (out.reached) reachedAny = true;
      streams = streams.concat(out.streams);
      if (streams.length) break;
    }

    const seen = new Set<string>();
    streams = streams.filter((s) => {
      if (!s?.link || seen.has(s.link)) return false;
      seen.add(s.link);
      return true;
    });

    if (!streams.length) {
      const hosts = Array.from(
        new Set(
          targets.map((t) => {
            try {
              return new URL(t).host;
            } catch {
              return t;
            }
          }),
        ),
      ).join(", ");
      const onlyGated =
        targets.length > 0 && targets.every((t) => XD_LINK_HOSTS.test(t));
      const noWebView = typeof providerContext.openWebView !== "function";

      let reason: string;
      if (onlyGated && noWebView) {
        // Not a network problem - the shortener sits behind Cloudflare
        // Turnstile plus a countdown, which needs the in-app WebView.
        reason =
          `the only links for this title go through ${hosts}, which is behind a Cloudflare verification gate. ` +
          `Open this title in the app (not the CLI test) so the verification WebView can run, or pick a quality served by HubCloud.`;
      } else if (reachedAny) {
        reason = `${hosts} responded but exposed no downloadable files (the upload may have been removed). Try another quality.`;
      } else {
        reason =
          `could not reach any file host (${hosts}). This is usually ISP DNS blocking: ` +
          `try a VPN or 1.1.1.1 / 8.8.8.8 DNS, or set a working HubCloud domain in provider settings.`;
      }
      throw new Error(reason);
    }

    if (isDownload) {
      streams.sort((a, b) => Number(isPlayable(a)) - Number(isPlayable(b)));
    } else {
      streams.sort((a, b) => Number(isPlayable(b)) - Number(isPlayable(a)));
    }
    return streams;
  } catch (err) {
    throwProviderError(PROVIDER_NAME, "getStream", err);
  }
};
