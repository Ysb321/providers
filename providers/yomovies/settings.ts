import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE_URL } from "./utils";

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
        "Override the default yomovies domain if it changes or is blocked in your region.",
      placeholder: DEFAULT_BASE_URL,
      defaultValue: "",
    },
    {
      key: "yomoviesPreferHls",
      type: "toggle",
      label: "Prefer HLS streams",
      description:
        "Put adaptive .m3u8 streams first when playing (mp4 is always preferred for downloads).",
      defaultValue: true,
    },
  ];
};
