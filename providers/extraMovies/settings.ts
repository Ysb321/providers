import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE_URL } from "./client";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "extraMoviesBaseUrl",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description:
        "Override the ExtraMovies domain if it changes or is blocked in your region.",
      placeholder: DEFAULT_BASE_URL,
      defaultValue: "",
    },
    {
      key: "extraMoviesHubcloudDomain",
      type: "text",
      label: "HubCloud Domain",
      description:
        "Download links point at HubCloud, which rotates domains and is often DNS-blocked by ISPs. If streams fail with a network error, enter a HubCloud domain that opens in your browser (e.g. hubcloud.art).",
      placeholder: "hubcloud.art",
      defaultValue: "",
    },
  ];
};
