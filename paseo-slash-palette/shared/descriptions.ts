import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Palette preferences, keyed by the command name the agent's session reports
 * (`compact`, `skill:slide-authoring`, …).
 *
 * `descriptions` overrides the provider's own text; an absent entry uses it as-is.
 * `pinned` marks commands shown above the rest — stored in pin order, but always
 * rendered in the provider's own order.
 */
export const commandDescriptions = defineSettings({
  id: "command-descriptions",
  scope: "host",
  version: 1,
  schema: z.object({
    descriptions: z.record(z.string(), z.string()).default({}),
    pinned: z.array(z.string()).default([]),
  }),
});
