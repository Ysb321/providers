import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE_URL } from "./client";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "net77BaseUrl",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description:
        "NetMirror rotates its domain every few weeks (net27.cc, net77.cc, ...). Set the current one here if the default stops working.",
      placeholder: DEFAULT_BASE_URL,
      defaultValue: "",
    },
    {
      key: "net77UseFallback",
      type: "toggle",
      label: "Use MP4 fallback",
      description:
        "When the main site only offers a preview reel to guests, try net27.cc's TMDB-keyed API for direct MP4 files.",
      defaultValue: true,
    },
    {
      key: "net77TmdbKey",
      type: "text",
      label: "TMDB API Key (optional)",
      description:
        "Only used to match a title to a TMDB id for the MP4 fallback. Leave blank to use the built-in key.",
      placeholder: "your TMDB v3 api key",
      defaultValue: "",
    },
  ];
};
