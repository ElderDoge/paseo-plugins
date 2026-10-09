import type { PluginServerContext } from "@getpaseo/plugin/server";
import { commandDescriptions } from "./shared/descriptions";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(commandDescriptions);
  return () => {};
}
