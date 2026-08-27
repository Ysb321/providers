import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE_URL, DEFAULT_ENC_DEC_API } from "./client";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "redflixBaseUrl",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description:
        "Redflix rotates domains (redflix.club, redflix.co, ...). Set the one that opens in your browser if the default stops working. Only affects search and the web link - playback does not depend on it.",
      placeholder: DEFAULT_BASE_URL,
      defaultValue: "",
    },
    {
      key: "redflixUseVideasy",
      type: "toggle",
      label: "Videasy sources",
      description:
        "Eight upstream servers with multi-language audio (Original, Hindi, German, Spanish, Portuguese).",
      defaultValue: true,
    },
    {
      key: "redflixUseVidfast",
      type: "toggle",
      label: "VidFast sources",
      description:
        "Additional servers, often including 4K. Slower to resolve than Videasy.",
      defaultValue: true,
    },
    {
      key: "redflixVerifyStreams",
      type: "toggle",
      label: "Verify links before playing",
      description:
        "Checks each link really serves video and hides dead ones. Turn off for slightly faster loading at the risk of a link that resolves but will not play.",
      defaultValue: true,
    },
    {
      key: "redflixEncDecApi",
      type: "text",
      label: "Decryption helper URL",
      description:
        "The embed providers return encrypted payloads that must be decoded by a helper service. Change this only if you self-host EncDecEndpoints.",
      placeholder: DEFAULT_ENC_DEC_API,
      defaultValue: "",
    },
  ];
};
