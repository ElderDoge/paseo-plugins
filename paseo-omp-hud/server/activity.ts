import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { activityRpc } from "../shared/activity";
import { readOmpActivity } from "./session-reader";

export async function getActivity({
  sessionFile,
}: RpcInput<typeof activityRpc>): Promise<RpcOutput<typeof activityRpc>> {
  return readOmpActivity(sessionFile);
}
