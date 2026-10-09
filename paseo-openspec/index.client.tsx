import type { PluginClientContext } from "@getpaseo/plugin/client";
import { OpenspecPanel } from "./client/panel";

/** Panel id shared by the tab registration and the Command Center entry. */
const PANEL_ID = "openspec";
const PANEL_ICON = "ListTree";

export default function contribute(client: PluginClientContext): () => void {
  const panel = client.addWorkspacePanel({
    id: PANEL_ID,
    title: "OpenSpec",
    icon: PANEL_ICON,
    context: "workspace",
    // Wide layouts show it beside agents and terminals; the Explorer is narrow.
    locations: ["workspace", "explorer"],
    Component: OpenspecPanel,
  });
  const command = client.addCommandCenterItem({
    id: "openspec-open",
    title: "打开 OpenSpec 变更面板",
    icon: PANEL_ICON,
    keywords: ["openspec", "变更", "规范", "spec", "任务"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });
  return () => {
    panel();
    command();
  };
}
