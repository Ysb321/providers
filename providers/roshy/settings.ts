import { ProviderContext, SettingsField } from "../types";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "baseUrlOverride",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description:
        "Base URL of the movies/TV site this provider scrapes (e.g. https://example.com)",
      placeholder: "https://example.com",
      defaultValue: "",
    },
    {
      key: "roshy_quickDownload",
      type: "toggle",
      label: "Quick Download",
      description:
        "Automatically download the preferred server in 1-click without asking to select a server",
      defaultValue: true,
    },
    {
      key: "roshy_allowedResolutions",
      type: "multiselect",
      label: "Allowed Video Resolutions",
      description: "Choose video resolutions to include in streams list",
      options: [
        { label: "4K (2160p)", value: "2160" },
        { label: "1080p Full HD", value: "1080" },
        { label: "720p HD", value: "720" },
        { label: "480p SD", value: "480" },
      ],
      defaultValue: ["2160", "1080", "720"],
    },
  ];
};
