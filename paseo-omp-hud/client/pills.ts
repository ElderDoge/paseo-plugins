import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { activityRpc } from "../shared/activity";
import {
  activityLabel,
  activityTitle,
  forgetActivity,
  publishActivity,
  readActivity,
  setActivityStatus,
} from "./activity-model";
import { ActivityIcon, ActivityPopover } from "./components";

/**
 * Floor between two reads of the same agent. Tool activity arrives as a dense
 * event stream, and coalescing keeps the read rate near two per second.
 */
const MIN_POLL_GAP_MS = 400;
const PILL_ID = "omp-activity";
/** Page size for the initial agent listing. */
const LIST_PAGE_LIMIT = 200;

/** The subset of the daemon's agent record this plugin consumes. */
interface ObservedAgent {
  id: string;
  provider: string;
  status: string;
  workspaceId?: string | null;
  persistence?: { nativeHandle?: string | null } | null;
}

interface TrackedAgent {
  agentId: string;
  workspaceId: string;
  status: string;
  sessionFile: string;
  polling: boolean;
  dirty: boolean;
  lastPollAt: number;
  lastLabel: string | null;
  lastTitle: string | null;
  releaseStream: (() => void) | null;
}

/**
 * Keeps one composer pill per omp agent in sync with that agent's session journal.
 *
 * Reads are driven entirely by daemon pushes — agent updates for status, and the
 * agent's timeline stream for tool activity — because a client timer is throttled
 * whenever the Paseo window is not in front, which would freeze the pill mid-turn.
 */
export function contributePills(client: PluginClientContext): () => void {
  const agents = new Map<string, TrackedAgent>();
  const pills = new Map<string, PluginButtonRegistration>();
  let stopped = false;

  const refreshPill = (tracked: TrackedAgent): void => {
    const pill = pills.get(tracked.agentId);
    if (!pill) return;
    const activity = readActivity(tracked.agentId);
    const label = activityLabel(activity);
    const title = activityTitle(activity);
    if (label === tracked.lastLabel && title === tracked.lastTitle) return;
    tracked.lastLabel = label;
    tracked.lastTitle = title;
    pill.update({ label, title });
  };

  const poll = async (tracked: TrackedAgent): Promise<void> => {
    const sessionFile = tracked.sessionFile;
    try {
      const snapshot = await client.rpc(activityRpc, { sessionFile });
      if (stopped || agents.get(tracked.agentId) !== tracked || tracked.sessionFile !== sessionFile) return;
      publishActivity(tracked.agentId, {
        sessionFile,
        status: tracked.status,
        snapshot,
        receivedAt: Date.now(),
      });
      refreshPill(tracked);
    } catch (error) {
      if (!stopped) console.error("读取 omp 会话记录失败", error);
    }
  };

  const requestPoll = (tracked: TrackedAgent, force: boolean): void => {
    if (stopped) return;
    if (tracked.polling) {
      tracked.dirty = true;
      return;
    }
    if (!force && Date.now() - tracked.lastPollAt < MIN_POLL_GAP_MS) return;
    tracked.polling = true;
    tracked.dirty = false;
    tracked.lastPollAt = Date.now();
    void poll(tracked).finally(() => {
      tracked.polling = false;
      if (tracked.dirty) {
        tracked.dirty = false;
        requestPoll(tracked, true);
      }
    });
  };

  const watchStream = (tracked: TrackedAgent): void => {
    if (tracked.releaseStream) return;
    const subscription = client.paseo.agents.ref(tracked.agentId).timeline.subscribe(() => {
      requestPoll(tracked, false);
    });
    tracked.releaseStream = () => subscription();
  };

  const unwatchStream = (tracked: TrackedAgent): void => {
    tracked.releaseStream?.();
    tracked.releaseStream = null;
  };

  const syncStream = (tracked: TrackedAgent): void => {
    if (tracked.status === "running") watchStream(tracked);
    else unwatchStream(tracked);
  };

  const drop = (agentId: string): void => {
    const tracked = agents.get(agentId);
    if (tracked) unwatchStream(tracked);
    agents.delete(agentId);
    forgetActivity(agentId);
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  const track = (agent: ObservedAgent): void => {
    const sessionFile = agent.persistence?.nativeHandle ?? null;
    const workspaceId = agent.workspaceId ?? null;
    if (agent.provider !== "omp" || !sessionFile || !workspaceId) {
      drop(agent.id);
      return;
    }
    const tracked = agents.get(agent.id);
    if (!tracked) {
      const created: TrackedAgent = {
        agentId: agent.id,
        workspaceId,
        status: agent.status,
        sessionFile,
        polling: false,
        dirty: false,
        lastPollAt: 0,
        lastLabel: null,
        lastTitle: null,
        releaseStream: null,
      };
      agents.set(agent.id, created);
      pills.set(
        agent.id,
        client.addComposerPill({
          id: PILL_ID,
          workspaceId,
          agentId: agent.id,
          button: {
            title: activityTitle(undefined),
            icon: ActivityIcon,
            label: activityLabel(undefined),
            behavior: { kind: "popover", Content: ActivityPopover },
          },
        }),
      );
      syncStream(created);
      requestPoll(created, true);
      return;
    }
    if (tracked.workspaceId !== workspaceId) {
      drop(agent.id);
      track(agent);
      return;
    }
    const statusChanged = tracked.status !== agent.status;
    const fileChanged = tracked.sessionFile !== sessionFile;
    tracked.status = agent.status;
    tracked.sessionFile = sessionFile;
    if (fileChanged) forgetActivity(agent.id);
    if (statusChanged) setActivityStatus(agent.id, agent.status);
    syncStream(tracked);
    refreshPill(tracked);
    if (statusChanged || fileChanged) requestPoll(tracked, true);
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
    for (const agentId of [...agents.keys()]) {
      if (!seen.has(agentId)) drop(agentId);
    }
  };

  void syncListing().catch((error) => {
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
    for (const agentId of [...agents.keys()]) drop(agentId);
  };
}
