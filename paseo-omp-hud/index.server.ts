import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getActivity } from "./server/activity";
import { activityRpc } from "./shared/activity";

export default function contribute(server: PluginServerContext) {
  server.handle(activityRpc, getActivity);
  return () => {};
}
