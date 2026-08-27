/**
 * Filters are `<ott>|<kind>[|<argument>]`.
 *  - `nf|home`   : the Netflix catalogue landing page
 *  - `pv|home`   : the Prime Video catalogue landing page
 *  - `nf|browse|<letter>` : alphabetical browse, used for paging
 */
export const catalog = [
  { title: "Netflix", filter: "nf|home" },
  { title: "Prime Video", filter: "pv|home" },
  { title: "Netflix A-Z", filter: "nf|browse" },
  { title: "Prime Video A-Z", filter: "pv|browse" },
];

export const genres = [
  { title: "Netflix Movies", filter: "nf|browse" },
  { title: "Prime Video Movies", filter: "pv|browse" },
];
