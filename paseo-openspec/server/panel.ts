import path from "node:path";
import { stat } from "node:fs/promises";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";
import { documentRpc, listRpc } from "../shared/openspec";
import type { CliLocation, ListRun } from "./cli";
import { firstLine, resolveCli, searchDirs, spawnList } from "./cli";
import { describeChange, isChangeId, readDocument } from "./documents";

/**
 * The subset of `openspec-cn list --json` this plugin reads. Unknown keys are
 * dropped and missing numbers default, so a CLI that grows fields or omits an
 * empty progress count still parses.
 */
const ListPayloadSchema = z.object({
  changes: z
    .array(
      z.object({
        name: z.string(),
        completedTasks: z.number().default(0),
        totalTasks: z.number().default(0),
        lastModified: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .default([]),
  root: z.object({ path: z.string(), source: z.string().optional() }).nullish(),
  status: z.array(z.object({ message: z.string().optional() })).optional(),
});

type ListPayload = z.infer<typeof ListPayloadSchema>;

/** Workspace directory -> resolved `openspec/` directory, for document reads. */
const ROOT_CACHE_LIMIT = 64;
const roots = new Map<string, string>();

function rememberRoot(directory: string, openspecDir: string): void {
  roots.delete(directory);
  roots.set(directory, openspecDir);
  if (roots.size <= ROOT_CACHE_LIMIT) return;
  const oldest = roots.keys().next();
  if (!oldest.done) roots.delete(oldest.value);
}

function parsePayload(stdout: string): ListPayload | null {
  const text = stdout.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = ListPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

type Resolution =
  | { status: "ok"; root: string; source: string; openspecDir: string; payload: ListPayload }
  | { status: "missing"; message: string }
  | { status: "cli-missing"; message: string; searched: string[] }
  | { status: "error"; message: string };

/**
 * Runs the CLI in `directory` and translates its payload into what the panel needs.
 *
 * Any remembered root for this directory is dropped first: a workspace whose
 * OpenSpec root moved or disappeared must not keep serving documents from the
 * old one, so only a fresh success puts an entry back.
 */
async function resolveRoot(directory: string): Promise<Resolution> {
  roots.delete(directory);
  const directoryInfo = await stat(directory).catch(() => null);
  if (directoryInfo === null || !directoryInfo.isDirectory()) {
    return { status: "error", message: `工作区目录不存在：${directory}` };
  }
  const location: CliLocation | null = resolveCli();
  if (location === null) {
    return {
      status: "cli-missing",
      message: "未找到 openspec-cn 命令，请确认已全局安装 @studyzy/openspec-cn。",
      searched: searchDirs(),
    };
  }
  let run: ListRun;
  try {
    run = await spawnList(location, directory);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "error", message: `无法运行 ${location.command}：${detail}` };
  }
  const payload = parsePayload(run.stdout);
  if (payload === null) {
    if (run.failure === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { status: "error", message: `${location.command} list --json 的输出超过 32MB。` };
    }
    if (run.timedOut) {
      return { status: "error", message: `${location.command} list --json 超过 20 秒未返回。` };
    }
    const detail = firstLine(run.stderr) || firstLine(run.stdout);
    return {
      status: "error",
      message: `${location.command} list --json 未返回可解析的 JSON${detail ? `：${detail}` : "。"}`,
    };
  }
  if (!payload.root) {
    return {
      status: "missing",
      message: payload.status?.[0]?.message ?? "当前工作区没有 OpenSpec 根目录。",
    };
  }
  const openspecDir = path.join(payload.root.path, "openspec");
  rememberRoot(directory, openspecDir);
  return {
    status: "ok",
    root: payload.root.path,
    source: payload.root.source ?? "unknown",
    openspecDir,
    payload,
  };
}

/** The workspace's active changes, with progress and the documents each one holds. */
export async function listChanges({
  directory,
}: RpcInput<typeof listRpc>): Promise<RpcOutput<typeof listRpc>> {
  const resolution = await resolveRoot(directory);
  switch (resolution.status) {
    case "cli-missing":
      return { status: "cli-missing", message: resolution.message, searched: resolution.searched };
    case "missing":
      return { status: "missing", message: resolution.message };
    case "error":
      return { status: "error", message: resolution.message };
    case "ok":
      break;
  }
  const { openspecDir, payload } = resolution;
  const changes = await Promise.all(
    payload.changes
      .filter((entry) => isChangeId(entry.name))
      .map((entry) =>
        describeChange(openspecDir, {
          id: entry.name,
          completedTasks: entry.completedTasks,
          totalTasks: entry.totalTasks,
          status: entry.status ?? "",
          lastModified: entry.lastModified ?? "",
        }),
      ),
  );
  return {
    status: "ok",
    root: resolution.root,
    source: resolution.source,
    openspecDir,
    changes,
  };
}

/** One document of one change, restricted to the paths `openspec.list` handed out. */
export async function readChangeDocument({
  directory,
  path: relPath,
}: RpcInput<typeof documentRpc>): Promise<RpcOutput<typeof documentRpc>> {
  try {
    let openspecDir = roots.get(directory);
    if (openspecDir === undefined) {
      // The panel lists before it reads, so this only happens after a restart or
      // when the cache dropped this workspace.
      const resolution = await resolveRoot(directory);
      if (resolution.status === "cli-missing" || resolution.status === "error") {
        return { status: "error", message: resolution.message };
      }
      openspecDir = resolution.status === "ok" ? resolution.openspecDir : undefined;
    }
    if (openspecDir === undefined) return { status: "missing" };
    return await readDocument(openspecDir, relPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "error", message: `读取文档失败：${detail}` };
  }
}
