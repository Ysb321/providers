import { ProviderContext, SettingsField } from "../types";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "preferredQuality",
      type: "select",
      label: "Preferred Quality",
      description: "Default streaming quality when multiple are available",
      options: [
        { label: "Auto (Best Available)", value: "auto" },
        { label: "1080p Full HD", value: "1080" },
        { label: "720p HD", value: "720" },
        { label: "480p SD", value: "480" },
      ],
      defaultValue: "auto",
    },
    {
      key: "allowedResolutions",
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
    {
      key: "baseUrlOverride",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description: "Override default domain if blocked in your region",
      placeholder: "https://example.com",
      defaultValue: "",
    },
    {
      key: "autoSubtitles",
      type: "toggle",
      label: "Auto-enable subtitles",
      description: "Automatically load English subtitles when available",
      defaultValue: true,
    },
    {
      key: "requestTimeoutSecs",
      type: "number",
      label: "Request Timeout (seconds)",
      description: "Maximum time to wait for scraper responses",
      defaultValue: 15,
      min: 5,
      max: 60,
    },
  ];
};
