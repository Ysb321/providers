import { Info, ProviderContext } from "../types";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  // Fetch and parse metadata for the item using axios and cheerio
  // const { axios, cheerio } = providerContext;
  
  return {
    title: "Example Content",
    synopsis: "This is an example synopsis for the Vega App Provider Template. Once you have tested this, delete this example provider and create your own!",
    image: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba",
    imdbId: "tt1234567",
    type: "movie",
    linkList: [
      {
        title: "Movie Links",
        directLinks: [
          {
            link: "https://example.com/stream-1",
            title: "Play Movie",
            type: "movie",
          },
        ],
        quality: "1080p",
      },
    ],
  };
};
