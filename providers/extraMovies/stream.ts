import { ProviderContext, Stream } from "../types";
import { throwProviderError } from "../providerErrors";
import { hubcloudExtractor } from "../extractors/hubcloud";
import { gdflixExtractor } from "../extractors/gdflix";
import { gofileExtractor } from "../extractors/gofile";
import {
  extractorHeaders,
  fetchPage,
  getBaseUrl,
  PROVIDER_NAME,
} from "./client";

/** Hosts the hubcloud extractor understands. */
const HUBCLOUD_HOSTS = /(hubcloud|hubdrive|vcloud|driveleech|driveseed)/i;

/** GDFlix has its own extractor - its pages look nothing like hubcloud's. */
const GDFLIX_HOSTS = /(gdflix|gdlink|gdtot|\bflix\b)/i;

/** FilePress/FileBee mirrors - resolved by following to their real host. */
const FILEPRESS_HOSTS = /(filepress|filebee|pressfile|filecrypt)/i;

/** Any file host we can attempt, in the order we prefer to try them. */
const SUPPORTED_HOSTS = [
  HUBCLOUD_HOSTS,
  GDFLIX_HOSTS,
  /gofile\.io/i,
  FILEPRESS_HOSTS,
];

function isSupportedHost(url: string): boolean {
  return SUPPORTED_HOSTS.some((re) => re.test(url));
}

/** Ranks a link so the most reliably-resolvable hosts are tried first. */
function hostPriority(url: string): number {
  if (HUBCLOUD_HOSTS.test(url)) return 0;
  if (GDFLIX_HOSTS.test(url)) return 1;
  if (/gofile\.io/i.test(url)) return 2;
  if (FILEPRESS_HOSTS.test(url)) return 3;
  return 9;
}

/**
 * Known hubcloud mirror domains. The site rotates these (we have seen
 * `hubcloud.cx/drive/...` and `hubcloud.art/video/...`), and Indian ISPs
 * routinely DNS-block individual ones - which surfaces as an axios
 * "Network Error" with no HTTP response at all. Trying the same path on
 * sibling domains recovers from both cases.
 */
const HUBCLOUD_MIRRORS = [
  "hubcloud.art",
  "hubcloud.cx",
  "hubcloud.dad",
  "hubcloud.one",
  "hubcloud.foo",
  "hubcloud.bz",
  "hubcloud.ink",
];

/**
 * Servers that can only be downloaded, never streamed. The app uses this to
 * avoid handing an unplayable link to the video player.
 */
export const nonStreamableServer = ["G-Drive (download only)", "Gofile"];

function isPlayable(stream: Stream): boolean {
  const server = (stream.server || "").toLowerCase();
  if (nonStreamableServer.some((s) => server === s.toLowerCase())) return false;
  if (/download only/i.test(stream.server || "")) return false;
  return true;
}

/**
 * True when a request never reached the server (DNS failure, connection
 * refused/reset, TLS error, timeout). axios reports these as "Network Error"
 * with `error.response` undefined - distinct from an HTTP 4xx/5xx, and the
 * signature of a blocked or dead mirror.
 */
function isNetworkError(err: any): boolean {
  if (err?.response) return false;
  const msg = String(err?.message || err || "");
  return /network error|timeout|timedout|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ECONNABORTED|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|certificate|socket hang up|getaddrinfo/i.test(
    msg,
  );
}

/** Builds the ordered list of mirror URLs to try for a hubcloud-family link. */
function mirrorCandidates(url: string, preferred?: string): string[] {
  const candidates: string[] = [];
  const push = (u: string) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };

  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return [url];
  }

  // A user-supplied domain always wins.
  if (preferred) {
    const clean = preferred.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (clean) push(url.replace(host, clean));
  }

  push(url);

  if (/hubcloud/i.test(host)) {
    for (const mirror of HUBCLOUD_MIRRORS) {
      if (mirror !== host) push(url.replace(host, mirror));
    }
  }

  return candidates;
}

/**
 * Runs the hubcloud extractor against a link, falling back across mirror
 * domains when the host is unreachable. Returns [] rather than throwing so a
 * single dead mirror cannot abort the whole getStream.
 */
async function extractHubcloud({
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
}): Promise<{ streams: Stream[]; reachedAnyMirror: boolean }> {
  const { axios, cheerio } = providerContext;
  const candidates = mirrorCandidates(url, preferredDomain);
  let lastError: any;
  let reachedAnyMirror = false;

  for (const candidate of candidates) {
    try {
      // The extractor mutates the headers object, so hand it a fresh copy.
      const headers = await extractorHeaders(providerContext);
      const result = await hubcloudExtractor(
        candidate,
        signal as AbortSignal,
        axios,
        cheerio,
        headers,
        providerContext,
        isDownload,
        PROVIDER_NAME,
      );
      // Returning at all means the host answered, even with zero links.
      reachedAnyMirror = true;
      const streams = Array.isArray(result) ? (result as Stream[]) : [];
      if (streams.length) return { streams, reachedAnyMirror };
      // The mirror is alive but exposed no files - a sibling domain serving
      // the same id will behave identically, so stop here.
      console.log(`extraMovies: ${candidate} reachable but returned no links`);
      break;
    } catch (err) {
      lastError = err;
      // Only a genuinely unreachable host is worth retrying elsewhere; an HTTP
      // error means the mirror answered and the content is simply gone.
      const cause = (err as any)?.cause ?? err;
      if (!isNetworkError(err) && !isNetworkError(cause)) {
        reachedAnyMirror = true;
        console.log(`extraMovies: ${candidate} failed (not retryable):`, err);
        break;
      }
      console.log(`extraMovies: ${candidate} unreachable, trying next mirror`);
    }
  }

  if (lastError) {
    console.log("extraMovies: hubcloud extraction failed for", url, lastError);
  }
  return { streams: [], reachedAnyMirror };
}

/**
 * GDFlix pages (`new.gdflix.cfd/file/...`) have their own layout and their own
 * extractor. Older ExtraMovies posts use GDFlix instead of HubCloud, so this
 * must never be routed through the hubcloud extractor.
 */
async function extractGdflix({
  url,
  providerContext,
  signal,
}: {
  url: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<{ streams: Stream[]; reachedAnyMirror: boolean }> {
  const { axios, cheerio } = providerContext;
  let reachedAnyMirror = false;

  try {
    const headers = await extractorHeaders(providerContext);
    const result = await gdflixExtractor(
      url,
      signal as AbortSignal,
      axios,
      cheerio,
      headers,
      providerContext,
    );
    reachedAnyMirror = true;
    const streams = Array.isArray(result) ? (result as Stream[]) : [];
    return { streams, reachedAnyMirror };
  } catch (err) {
    const cause = (err as any)?.cause ?? err;
    if (!isNetworkError(err) && !isNetworkError(cause)) {
      reachedAnyMirror = true;
    }
    console.log("extraMovies: gdflix extraction failed for", url, err);
    return { streams: [], reachedAnyMirror };
  }
}

/**
 * FilePress / FileBee pages are thin wrappers that point at a real file host.
 * Follow the page and hand whatever supported link it exposes to the matching
 * extractor.
 */
async function extractFilepress({
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
}): Promise<{ streams: Stream[]; reachedAnyMirror: boolean }> {
  const { axios, cheerio } = providerContext;

  try {
    const headers = await extractorHeaders(providerContext);
    const res = await axios.get(url, { headers, signal });
    const html: string = typeof res.data === "string" ? res.data : "";
    const $ = cheerio.load(html || "");

    const nested: string[] = [];
    $("a[href]").each((_: unknown, el: any) => {
      const href = ($(el).attr("href") || "").trim();
      if (href && isSupportedHost(href) && !FILEPRESS_HOSTS.test(href)) {
        nested.push(href);
      }
    });

    // Some skins put the onward url in a script redirect instead of an anchor.
    const scripted = html.match(
      /(?:location\.(?:replace|href)\s*=?\s*\(?['"])(https?:\/\/[^'"]+)['"]/i,
    )?.[1];
    if (scripted && isSupportedHost(scripted)) nested.push(scripted);

    for (const candidate of Array.from(new Set(nested))) {
      const out = GDFLIX_HOSTS.test(candidate)
        ? await extractGdflix({ url: candidate, providerContext, signal })
        : await extractHubcloud({
            url: candidate,
            providerContext,
            signal,
            isDownload,
            preferredDomain,
          });
      if (out.streams.length) return out;
    }

    // We reached the wrapper even if it led nowhere useful.
    return { streams: [], reachedAnyMirror: true };
  } catch (err) {
    const cause = (err as any)?.cause ?? err;
    const reached = !isNetworkError(err) && !isNetworkError(cause);
    console.log("extraMovies: filepress extraction failed for", url, err);
    return { streams: [], reachedAnyMirror: reached };
  }
}

async function extractGofile({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<Stream[]> {
  const { axios } = providerContext;
  try {
    const contentId = url.split("/").filter(Boolean).pop() || "";
    if (!contentId) return [];
    const headers = await extractorHeaders(providerContext);
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
  } catch (err) {
    console.log("extraMovies: gofile extraction failed:", err);
    return [];
  }
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
        (await providerContext.kvStore.get<string>(
          "extraMoviesHubcloudDomain",
        )) || "";
    } catch {
      /* ignore */
    }

    // Collect every candidate file-host link, not just the first one. A post
    // lists 480p/720p/1080p mirrors, so if one host is dead the others can
    // still produce a stream.
    let targets: string[] = [];

    if (link.includes(new URL(baseUrl).host)) {
      const html = await fetchPage({
        url: link,
        providerContext,
        signal,
        referer: baseUrl + "/",
      });
      const $ = cheerio.load(html || "");
      $("a[href]").each((_, el) => {
        const href = ($(el).attr("href") || "").trim();
        if (!href) return;
        if (isSupportedHost(href)) {
          if (!targets.includes(href)) targets.push(href);
        }
      });
    } else {
      targets = [link];
    }

    if (!targets.length) return [];

    // Try the most reliably-resolvable hosts first (hubcloud, then gdflix,
    // gofile, and finally filepress wrappers).
    targets.sort((a, b) => hostPriority(a) - hostPriority(b));

    let streams: Stream[] = [];
    let reachedAnyHost = false;
    for (const target of targets) {
      let resolved: Stream[] = [];

      if (/gofile\.io/i.test(target)) {
        resolved = await extractGofile({ url: target, providerContext });
        if (resolved.length) reachedAnyHost = true;
      } else if (GDFLIX_HOSTS.test(target)) {
        const out = await extractGdflix({
          url: target,
          providerContext,
          signal,
        });
        resolved = out.streams;
        if (out.reachedAnyMirror) reachedAnyHost = true;
      } else if (FILEPRESS_HOSTS.test(target)) {
        const out = await extractFilepress({
          url: target,
          providerContext,
          signal,
          isDownload,
          preferredDomain,
        });
        resolved = out.streams;
        if (out.reachedAnyMirror) reachedAnyHost = true;
      } else {
        const out = await extractHubcloud({
          url: target,
          providerContext,
          signal,
          isDownload,
          preferredDomain,
        });
        resolved = out.streams;
        if (out.reachedAnyMirror) reachedAnyHost = true;
      }

      streams = streams.concat(resolved);

      // One good source is enough for playback; keep going only if we have
      // nothing yet.
      if (streams.length) break;
    }

    streams = (streams || []).filter((s) => s && s.link);

    const seen = new Set<string>();
    streams = streams.filter((s) => {
      if (seen.has(s.link)) return false;
      seen.add(s.link);
      return true;
    });

    if (!streams.length) {
      if (reachedAnyHost) {
        // The file host answered but exposed no downloadable files - the
        // upload is usually dead/removed rather than anything being blocked.
        throw new Error(
          `${targets[0]} responded but exposed no downloadable files (the upload may have been removed). Try a different quality on this title.`,
        );
      }
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
      throw new Error(
        `could not reach any file host (${hosts}). ` +
          `This is usually ISP DNS blocking: try a VPN or 1.1.1.1 / 8.8.8.8 DNS, or set a working HubCloud domain in provider settings.`,
      );
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
