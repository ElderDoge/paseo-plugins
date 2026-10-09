import { useSyncExternalStore } from "react";
import type { ActivitySnapshot } from "../shared/activity";

export type ActivityPhase = "tool" | "thinking" | "idle";

/** Latest read of one omp agent's session journal. */
export interface AgentActivity {
  sessionFile: string;
  /** Paseo agent status, which separates a live turn from an idle agent. */
  status: string;
  snapshot: ActivitySnapshot;
  receivedAt: number;
}

const activities = new Map<string, AgentActivity>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishActivity(agentId: string, activity: AgentActivity): void {
  activities.set(agentId, activity);
  emit();
}

export function setActivityStatus(agentId: string, status: string): void {
  const current = activities.get(agentId);
  if (!current || current.status === status) return;
  activities.set(agentId, { ...current, status });
  emit();
}

export function forgetActivity(agentId: string): void {
  if (activities.delete(agentId)) emit();
}

export function readActivity(agentId: string): AgentActivity | undefined {
  return activities.get(agentId);
}

export function useAgentActivity(agentId: string): AgentActivity | undefined {
  return useSyncExternalStore(subscribe, () => activities.get(agentId));
}

export function activityPhase(activity: AgentActivity | undefined): ActivityPhase {
  if (!activity || activity.status !== "running") return "idle";
  return activity.snapshot.tool ? "tool" : "thinking";
}

/**
 * One-line pill label: what the agent is doing right now. While the model thinks
 * between two calls the previous action stays on screen, so the text only ever
 * changes when a newer action replaces it. Paseo ellipsizes it to the pill width.
 */
export function activityLabel(activity: AgentActivity | undefined): string {
  const phase = activityPhase(activity);
  const tool = activity?.snapshot.tool;
  const previous = activity?.snapshot.recent[0];
  if (phase === "tool") return tool?.intent ?? tool?.name ?? "执行中";
  if (phase === "thinking") return previous?.intent ?? previous?.name ?? "思考中…";
  return activity?.snapshot.todo?.current ?? "空闲";
}

/** Hover text: the same picture, with the tool name kept for the truncated label. */
export function activityTitle(activity: AgentActivity | undefined): string {
  const phase = activityPhase(activity);
  if (phase === "tool") return describeTool(activity?.snapshot.tool) ?? "执行中";
  if (phase === "thinking") return describeTool(activity?.snapshot.recent[0]) ?? "模型响应中";
  return activity?.snapshot.todo?.current ?? "空闲";
}

/** `bash：运行测试`, falling back to the bare tool name when the call carries no intent. */
export function describeTool(tool: { name: string; intent: string | null } | null | undefined): string | null {
  if (!tool) return null;
  if (!tool.name) return tool.intent;
  return tool.intent ? `${tool.name}：${tool.intent}` : tool.name;
}
