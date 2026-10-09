import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listChanges, readChangeDocument } from "./server/panel";
import { documentRpc, listRpc } from "./shared/openspec";

export default function contribute(server: PluginServerContext) {
  server.handle(listRpc, listChanges);
  server.handle(documentRpc, readChangeDocument);
  return () => {};
}
