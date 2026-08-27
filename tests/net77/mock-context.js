/**
 * A ProviderContext whose `axios` replays the captured NetMirror responses
 * instead of hitting the network, so the net77 provider can be verified
 * end-to-end without egress to net77.cc / net27.cc / tv.imgcdn.kim.
 */
const cheerio = require("cheerio");
const F = require("./fixtures");

function makeKvStore(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
    delete: async (key) => store.delete(key),
    keys: async () => Array.from(store.keys()),
    clear: async () => store.clear(),
    _raw: store,
  };
}

function ok(data, headers) {
  return { status: 200, data, headers: headers || {} };
}

/**
 * @param {object} opts
 * @param {"real"|"placeholder"} [opts.master]  what the HLS master resolves to
 * @param {boolean} [opts.playlistDown]         make playlist.php fail
 * @param {boolean} [opts.newTvDown]            make the NewTV pool fail
 * @param {boolean} [opts.rejectFirstSession]   reply "Invalid User" once
 * @param {object}  [opts.net27]                override the net27 payload
 * @param {object}  [opts.settings]             seed kvStore
 */
function createContext(opts = {}) {
  const calls = [];
  const state = { sessionIssued: 0, rejectedOnce: false };

  const master =
    opts.master === "placeholder" ? F.MASTER_PLACEHOLDER : F.MASTER_REAL;

  async function get(url, config = {}) {
    calls.push({ method: "GET", url, config });
    const cookie = (config.headers && config.headers.Cookie) || "";

    /* ---------- the site's JSON endpoints ---------- */
    if (url.includes("/search.php")) {
      const term = decodeURIComponent(
        (/[?&]s=([^&]*)/.exec(url) || [])[1] || "",
      ).toLowerCase();
      const isPv = url.includes("/pv/");
      if (isPv) {
        if (term.startsWith("reacher")) return ok(F.PV_SEARCH_REACHER);
        if (term === "a") return ok(F.PV_SEARCH_A);
        return ok({ type: 1, head: "Top Searches", searchResult: [] });
      }
      if (term.startsWith("stranger")) return ok(F.NF_SEARCH_STRANGER);
      if (term.startsWith("inception")) return ok(F.NF_SEARCH_INCEPTION);
      return ok({ type: 1, head: "Top Searches", searchResult: [] });
    }

    if (url.includes("/post.php")) {
      // The backend rejects a stale/missing guest session.
      if (opts.rejectFirstSession && !state.rejectedOnce) {
        state.rejectedOnce = true;
        return ok(F.INVALID_USER);
      }
      if (!/t_hash_t=/.test(cookie)) return ok(F.INVALID_USER);

      const id = (/[?&]id=([^&]*)/.exec(url) || [])[1] || "";
      if (id === "0RTZ57DQ6PBHH29UN5JS7U7CW4")
        return ok(F.PV_POST_REACHER_SERIES);
      if (id === "0P52WN3GC5OHP25WVULFKF2OUD")
        return ok(F.PV_POST_JACK_REACHER);
      return ok(F.INVALID_USER);
    }

    if (url.includes("/episodes.php")) return ok(F.PV_EPISODES_S2);

    if (url.includes("/playlist.php")) {
      if (opts.playlistDown) throw new Error("playlist.php 503");
      return ok(url.includes("/pv/") ? F.PV_PLAYLIST_EPISODE : F.NF_PLAYLIST_INCEPTION);
    }

    /* ---------- HLS masters ---------- */
    if (url.includes(".m3u8")) {
      // The CDN 404s when the player does not replay a Referer - this is the
      // "resolves but never plays" failure the provider guards against.
      if (!config.headers || !config.headers.Referer) {
        return { status: 404, data: "Not Found", headers: {} };
      }
      return ok(master);
    }

    /* ---------- NewTV pool ---------- */
    if (url.includes("/checknewtv.php")) {
      if (opts.newTvDown) throw new Error("ENOTFOUND");
      return ok(F.NEWTV_TOKEN);
    }
    if (url.includes("/newtv/player.php")) {
      if (opts.newTvDown) throw new Error("ENOTFOUND");
      return ok(F.NEWTV_PLAYER);
    }

    /* ---------- TMDB ---------- */
    if (url.includes("api.themoviedb.org")) {
      if (url.includes("/external_ids")) {
        return ok({
          imdb_id: url.includes("/tv/") ? "tt9288030" : "tt0790724",
        });
      }
      return ok(
        url.includes("/search/tv")
          ? F.TMDB_SEARCH_TV_REACHER
          : F.TMDB_SEARCH_MOVIE_JACK_REACHER,
      );
    }

    /* ---------- net27 fallback ---------- */
    if (url.includes("/api/embed-tmdb/")) {
      if (opts.net27) return ok(opts.net27);
      if (!url.includes("type=tv")) return ok(F.NET27_MOVIE);

      // Mirrors the live backend: `se`/`ep` select an episode, while the
      // legacy `s`/`e` names are ignored and collapse to S1E1.
      const se = Number((/[?&]se=(\d+)/.exec(url) || [])[1] || 0);
      const ep = Number((/[?&]ep=(\d+)/.exec(url) || [])[1] || 0);
      if (opts.legacyEpisodeParamsOnly || !se || !ep) {
        return ok(F.NET27_SERIES_S1E1);
      }
      return ok(
        Object.assign({}, F.NET27_SERIES_S1E1, {
          currentSeason: se,
          currentEpisode: ep,
        }),
      );
    }

    /* ---------- browse pages ---------- */
    if (url.includes("/mobile/")) return ok(F.MOBILE_WALL_HTML);
    if (url.includes("/pv")) {
      return ok(
        opts.homeWithoutDataPost ? F.PV_HOME_HTML_NO_DATAPOST : F.PV_HOME_HTML,
      );
    }
    if (url.endsWith("/home") || url.endsWith("/")) return ok(F.NF_HOME_HTML);

    return { status: 404, data: "Not Found", headers: {} };
  }

  async function post(url, body, config = {}) {
    calls.push({ method: "POST", url, body, config });
    if (url.includes("/verify.php")) {
      state.sessionIssued += 1;
      return {
        status: 302,
        data: "",
        headers: {
          "set-cookie": [
            `t_hash_t=guest-token-${state.sessionIssued}; path=/; HttpOnly`,
          ],
        },
      };
    }
    return { status: 404, data: "", headers: {} };
  }

  return {
    context: {
      axios: { get, post },
      cheerio,
      commonHeaders: {},
      openWebView: async () => {
        throw new Error("WebView not available in tests");
      },
      kvStore: makeKvStore(opts.settings),
    },
    calls,
    state,
  };
}

module.exports = { createContext };
