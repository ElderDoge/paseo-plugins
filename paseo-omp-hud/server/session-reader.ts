import { open, stat } from "node:fs/promises";
import { z } from "zod";
import type { ActivitySnapshot } from "../shared/activity";

/** How much of the tail of an omp session journal is inspected. */
const TAIL_BYTES = 1024 * 1024;
/** Upper bound on inspected journal lines, newest first. */
const MAX_LINES = 4000;
/** How many recent tool calls are reported, newest first. */
const RECENT_LIMIT = 6;
/** Upper bound on remembered journals; the oldest entry is dropped first. */
const CACHE_LIMIT = 64;
/** Entry-level timestamp of an omp journal line. */
const ENTRY_TIMESTAMP = /"timestamp":"([^"]+)"/;

const UsageSchema = z.object({
  /** Prompt tokens that were not cached. */
  input: z.number().optional(),
  /** Output tokens, reasoning tokens included. */
  output: z.number().optional(),
  /** Prompt tokens served from the provider's cache. */
  cacheRead: z.number().optional(),
  /** Prompt tokens written into the provider's cache. */
  cacheWrite: z.number().optional(),
});

const JournalEntrySchema = z.object({
  type: z.string(),
  customType: z.string().optional(),
  data: z.unknown().optional(),
  message: z
    .object({
      role: z.string(),
      toolCallId: z.string().optional(),
      toolName: z.string().optional(),
      details: z.unknown().optional(),
      /** Milliseconds from request start to the first token; absent when the response streamed no thinking and no text. */
      ttft: z.number().nullish(),
      /** Milliseconds the whole model request took. */
      duration: z.number().nullish(),
      usage: UsageSchema.optional(),
    })
    .optional(),
});

const ToolStartSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string().optional(),
  intent: z.string().optional(),
  startedAt: z.string().optional(),
});

const TodoPhasesSchema = z.array(
  z.object({
    name: z.string().optional(),
    tasks: z.array(
      z.object({
        content: z.string(),
        status: z.string().optional(),
      }),
    ),
  }),
);

const TodoDetailsSchema = z.object({ phases: TodoPhasesSchema });

/** The last read of one journal, keyed by the file identity and write that produced it. */
const lastRead = new Map<
  string,
  { ino: number; size: number; mtimeMs: number; snapshot: ActivitySnapshot }
>();

async function readTailLines(sessionFile: string, size: number): Promise<string[]> {
  const start = Math.max(0, size - TAIL_BYTES);
  const handle = await open(sessionFile, "r");
  try {
    const chunks: Buffer[] = [];
    let offset = start;
    while (offset < size) {
      const chunk = Buffer.alloc(Math.min(TAIL_BYTES, size - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const lines = Buffer.concat(chunks).toString("utf8").split("\n");
    // A non-zero start almost certainly slices a line in half; drop the fragment.
    if (start > 0) lines.shift();
    return lines;
  } finally {
    await handle.close();
  }
}

function summarizeTodo(phases: z.infer<typeof TodoPhasesSchema>): ActivitySnapshot["todo"] {
  if (phases.length === 0) return null;

  const mapped = phases.map((phase) => ({
    name: phase.name ?? "",
    tasks: phase.tasks.map((task) => ({ content: task.content, status: task.status ?? "pending" })),
  }));

  let current: string | null = null;
  for (const phase of mapped) {
    for (const task of phase.tasks) {
      if (current === null && task.status === "in_progress") current = task.content;
    }
  }
  return { current, phases: mapped };
}

/**
 * Reads one omp session journal and reports what that session is doing right now.
 *
 * The journal is append-only, so the answer comes from the newest entries: the
 * most recent `tool_execution_start` custom entry whose call has no matching
 * `toolResult` is the call in flight, and the newest `todo` tool result (or
 * `user_todo_edit` snapshot) is the current plan. The newest starts are reported
 * as `recent` too, so a caller can keep showing the last action while the model
 * thinks, and list what came before it.
 *
 * Speed comes from the same pass: every assistant message carries its usage and
 * timing, so the newest response that streamed a first token reports the first
 * token delay, the output rate, and how much of its prompt came from cache. A
 * pure tool-call response reports no `ttft` and is skipped.
 *
 * Reads are remembered per journal, because callers poll on agent events rather
 * than on journal writes: measured over this machine's journals, 96% of polls
 * land in a window where the file has not changed at all. An unchanged journal
 * can only produce the same snapshot, so a poll costs one `stat`.
 */
export async function readOmpActivity(sessionFile: string): Promise<ActivitySnapshot> {
  const info = await stat(sessionFile).catch((error: NodeJS.ErrnoException) => {
    // omp keeps a brand-new session in memory until its first assistant message,
    // so an agent can legitimately reference a journal that does not exist yet.
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return { tool: null, recent: [], todo: null, performance: null };

  const remembered = lastRead.get(sessionFile);
  if (
    remembered &&
    remembered.ino === info.ino &&
    remembered.size === info.size &&
    remembered.mtimeMs === info.mtimeMs
  ) {
    return remembered.snapshot;
  }

  const snapshot = await readJournal(sessionFile, info.size);
  lastRead.set(sessionFile, { ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, snapshot });
  if (lastRead.size > CACHE_LIMIT) {
    const oldest = lastRead.keys().next().value;
    if (oldest !== undefined) lastRead.delete(oldest);
  }
  return snapshot;
}

async function readJournal(sessionFile: string, size: number): Promise<ActivitySnapshot> {
  const lines = await readTailLines(sessionFile, size);
  const closedCalls = new Set<string>();
  const runningTools: Array<{
    toolCallId: string;
    name: string;
    intent: string | null;
    startedAt: string;
  }> = [];
  const recent: ActivitySnapshot["recent"] = [];
  let todo: ActivitySnapshot["todo"] = null;
  let performance: ActivitySnapshot["performance"] = null;

  const oldest = Math.max(0, lines.length - MAX_LINES);
  for (let index = lines.length - 1; index >= oldest; index -= 1) {
    const raw = lines[index].trim();
    if (!raw.startsWith("{")) continue;

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsedEntry = JournalEntrySchema.safeParse(payload);
    if (!parsedEntry.success) continue;
    const entry = parsedEntry.data;
    const timestamp = ENTRY_TIMESTAMP.exec(raw)?.[1];

    if (entry.message) {
      if (entry.message.role === "assistant") {
        const usage = entry.message.usage;
        if (usage) {
          const { ttft, duration } = entry.message;
          // An aborted or failed request reports all-zero usage and no timings.
          const prompt = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
          const output = usage.output ?? 0;
          if (performance === null && prompt > 0 && output > 0 && ttft != null && duration != null && duration > ttft) {
            performance = {
              ttftMs: ttft,
              tokensPerSecond: output / ((duration - ttft) / 1000),
              cacheHitRate: (usage.cacheRead ?? 0) / prompt,
            };
          }
        }
        continue;
      }
      if (entry.message.role !== "toolResult") continue;
      if (entry.message.toolCallId) closedCalls.add(entry.message.toolCallId);
      if (todo === null && entry.message.toolName === "todo") {
        const details = TodoDetailsSchema.safeParse(entry.message.details);
        if (details.success) todo = summarizeTodo(details.data.phases);
      }
      continue;
    }

    if (entry.customType === "tool_execution_start") {
      const start = ToolStartSchema.safeParse(entry.data);
      if (!start.success) continue;
      const call = start.data;
      if (recent.length < RECENT_LIMIT) {
        recent.push({
          name: call.toolName ?? "",
          intent: call.intent?.trim() ? call.intent : null,
          startedAt: call.startedAt ?? timestamp ?? "",
        });
      }
      if (closedCalls.has(call.toolCallId)) continue;
      if (runningTools.some((tool) => tool.toolCallId === call.toolCallId)) continue;
      runningTools.push({
        toolCallId: call.toolCallId,
        name: call.toolName ?? "",
        intent: call.intent?.trim() ? call.intent : null,
        startedAt: call.startedAt ?? timestamp ?? "",
      });
      continue;
    }

    if (entry.customType === "user_todo_edit" && todo === null) {
      const edited = TodoDetailsSchema.safeParse(entry.data);
      if (edited.success) todo = summarizeTodo(edited.data.phases);
    }
  }

  const newest = runningTools[0];
  return {
    tool: newest
      ? {
          name: newest.name,
          intent: newest.intent,
          startedAt: newest.startedAt,
          running: runningTools.length,
        }
      : null,
    recent,
    todo,
    performance,
  };
}
