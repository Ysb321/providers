import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE_URL } from "./client";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "moviesDriveBaseUrl",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description:
        "MoviesDrive rotates domains constantly. Set the one that opens in your browser if the built-in mirrors stop working.",
      placeholder: DEFAULT_BASE_URL,
      defaultValue: "",
    },
  ];
};
