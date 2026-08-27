/**
 * Filters are `<mediaType>|<kind>[|<argument>]` and are resolved against the
 * keyless TMDB mirror the site itself uses. Redflix's own grids are
 * infinite-scroll (`/movies?page=2` re-serves page 1 - verified live), so the
 * mirror is the only reliable way to page.
 */
export const catalog = [
  { title: "Trending", filter: "all|trending" },
  { title: "Popular Movies", filter: "movie|popular" },
  { title: "Popular TV Shows", filter: "tv|popular" },
  { title: "Now Playing", filter: "movie|now_playing" },
  { title: "Airing Today", filter: "tv|airing_today" },
  { title: "Top Rated Movies", filter: "movie|top_rated" },
  { title: "Top Rated TV Shows", filter: "tv|top_rated" },
];

/** TMDB genre ids - used with /discover. */
export const genres = [
  { title: "Action", filter: "movie|genre|28" },
  { title: "Adventure", filter: "movie|genre|12" },
  { title: "Animation", filter: "movie|genre|16" },
  { title: "Comedy", filter: "movie|genre|35" },
  { title: "Crime", filter: "movie|genre|80" },
  { title: "Documentary", filter: "movie|genre|99" },
  { title: "Drama", filter: "movie|genre|18" },
  { title: "Family", filter: "movie|genre|10751" },
  { title: "Fantasy", filter: "movie|genre|14" },
  { title: "Horror", filter: "movie|genre|27" },
  { title: "Mystery", filter: "movie|genre|9648" },
  { title: "Romance", filter: "movie|genre|10749" },
  { title: "Science Fiction", filter: "movie|genre|878" },
  { title: "Thriller", filter: "movie|genre|53" },
  { title: "Action & Adventure (TV)", filter: "tv|genre|10759" },
  { title: "Drama (TV)", filter: "tv|genre|18" },
  { title: "Sci-Fi & Fantasy (TV)", filter: "tv|genre|10765" },
  { title: "Animation (TV)", filter: "tv|genre|16" },
];
