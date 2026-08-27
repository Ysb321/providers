import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE_URL } from "./client";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "yomoviesBaseUrl",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description:
        "Override the yomovies domain if it changes or is blocked in your region.",
      placeholder: DEFAULT_BASE_URL,
      defaultValue: "",
    },
  ];
};
