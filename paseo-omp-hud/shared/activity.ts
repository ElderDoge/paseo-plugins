import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const TodoTaskSchema = z.object({
  content: z.string(),
  status: z.string(),
});

const TodoPhaseSchema = z.object({
  name: z.string(),
  tasks: z.array(TodoTaskSchema),
});

const ToolStartSchema = z.object({
  /** Tool name, for example `read` or `bash`. */
  name: z.string(),
  /** The model-written one-line intent for that call, when the tool call carried one. */
  intent: z.string().nullable(),
  /** ISO timestamp of the call's start. */
  startedAt: z.string(),
});

const ToolActivitySchema = ToolStartSchema.extend({
  /** How many tool calls are in flight right now. */
  running: z.number(),
});

const TodoStateSchema = z.object({
  /** Content of the single in-progress task, or null. */
  current: z.string().nullable(),
  phases: z.array(TodoPhaseSchema),
});

const PerformanceSchema = z.object({
  /** Time from request start to first token, in milliseconds. */
  ttftMs: z.number(),
  /** Output tokens per second, counted from the first token onwards. */
  tokensPerSecond: z.number(),
  /** Share of that request's prompt served from cache, 0 to 1. */
  cacheHitRate: z.number(),
});

export const activityRpc = defineRpc({
  name: "activity.get",
  input: z.object({ sessionFile: z.string().min(1) }),
  output: z.object({
    tool: ToolActivitySchema.nullable(),
    /** Tool calls of the session, newest first — what the agent has been doing. */
    recent: z.array(ToolStartSchema),
    todo: TodoStateSchema.nullable(),
    /** Speed of the newest measurable model response. */
    performance: PerformanceSchema.nullable(),
  }),
});

export type ActivitySnapshot = z.infer<typeof activityRpc.output>;
