import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { PaletteIcon, SlashPalette } from "./client/palette";
import { DescriptionSettings } from "./client/settings-screen";

const PILL_ID = "slash-palette";
/** Page size for the initial agent listing. */
const LIST_PAGE_LIMIT = 200;

/** The subset of the daemon's agent record this plugin consumes. */
interface ObservedAgent {
  id: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
}

/**
 * Keeps one composer pill per active agent.
 *
 * The pill itself carries no state: it opens a popover that asks the agent's live
 * session for its slash commands, so nothing has to be refreshed when a provider
 * session reopens or a skill is installed.
 */
export default function contribute(client: PluginClientContext): () => void {
  const pills = new Map<string, { workspaceId: string; registration: PluginButtonRegistration }>();
  let stopped = false;

  client.addSettingsScreen({
    id: "descriptions",
    title: "命令描述",
    icon: "Languages",
    Component: DescriptionSettings,
  });

  const drop = (agentId: string): void => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  };

  const track = (agent: ObservedAgent): void => {
    const workspaceId = agent.workspaceId ?? null;
    if (!workspaceId || agent.archivedAt) {
      drop(agent.id);
      return;
    }
    const existing = pills.get(agent.id);
    if (existing) {
      if (existing.workspaceId === workspaceId) return;
      drop(agent.id);
    }
    pills.set(agent.id, {
      workspaceId,
      registration: client.addComposerPill({
        id: PILL_ID,
        workspaceId,
        agentId: agent.id,
        button: {
          title: "斜杠命令",
          icon: PaletteIcon,
          label: "命令",
          behavior: { kind: "popover", Content: SlashPalette },
        },
      }),
    });
  };

  const syncListing = async (): Promise<void> => {
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.paseo.agents.list({
        scope: "active",
        subscribe: {},
        page: cursor ? { limit: LIST_PAGE_LIMIT, cursor } : { limit: LIST_PAGE_LIMIT },
      });
      if (stopped) return;
      for (const entry of page.entries) {
        seen.add(entry.agent.id);
        track(entry.agent);
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    for (const agentId of [...pills.keys()]) {
      if (!seen.has(agentId)) drop(agentId);
    }
  };

  void syncListing().catch((error: unknown) => {
    if (!stopped) console.error("读取 agent 列表失败", error);
  });

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      drop(update.agentId);
      return;
    }
    track(update.agent);
  });

  return () => {
    stopped = true;
    unsubscribe();
    for (const agentId of [...pills.keys()]) drop(agentId);
  };
}
