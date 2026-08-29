import { ProviderContext, SettingsField } from "../types";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "roshy_quickDownload",
      type: "toggle",
      label: "Quick Download",
      description:
        "Automatically download the preferred server in 1-click without asking to select a server",
      defaultValue: true,
    },
    {
      key: "roshy_preferredDownloadServer",
      type: "select",
      label: "Preferred Download Server",
      description: "Server to prioritize for 1-click quick download",
      options: [
        { label: "Auto (Best Available)", value: "auto" },
        { label: "Download", value: "download" },
      ],
      defaultValue: "auto",
    },
  ];
};
