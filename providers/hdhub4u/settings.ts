import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE_URL } from "./client";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "hdhub4uBaseUrl",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description:
        "HDHub4u rotates domains frequently and is often DNS-blocked by Indian ISPs. Set the one that opens in your browser if the built-in mirrors stop working.",
      placeholder: DEFAULT_BASE_URL,
      defaultValue: "",
    },
  ];
};
