import type { Dirent, Stats } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { MAX_DOCUMENT_BYTES } from "../shared/openspec";
import type { ChangeDocument, ChangeStatus, ChangeSummary } from "../shared/openspec";

/** Documents listed inside one change, in tab order. */
const CHANGE_FILES: readonly { kind: "proposal" | "design" | "tasks"; file: string }[] = [
  { kind: "proposal", file: "proposal.md" },
  { kind: "design", file: "design.md" },
  { kind: "tasks", file: "tasks.md" },
];

/** The only paths `readDocument` accepts; everything else is refused unread. */
const DOCUMENT_PATH = /^changes\/[^/\\]+\/(?:[^/\\]+\/)*[^/\\]+\.md$/;

/** How much of `proposal.md` is inspected for the change summary. */
const SUMMARY_BYTES = 8 * 1024;
/** Longest summary kept for the list pane. */
const MAX_SUMMARY_LENGTH = 140;
/** Markdown line prefixes that are structure, not prose. */
const NOT_PROSE = /^(?:#{2,6}\s|#{1,6}$|[-*_]{3,}$|[-*+]\s|\d+[.)]\s|\||>|\[[ xX]\])/;

/** Drops inline Markdown so the summary reads as plain text in one line. */
function flattenSummary(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH);
}

/**
 * One line that tells the reader what a change is about.
 *
 * OpenSpec proposals either open with a `#` title or go straight to `## Why`,
 * so the first `#` heading wins and the first prose paragraph is the fallback.
 */
async function readSummary(proposalFile: string): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(proposalFile, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(SUMMARY_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SUMMARY_BYTES, 0);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    let inFence = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("```") || line.startsWith("~~~")) {
        inFence = !inFence;
        continue;
      }
      if (inFence || line.length === 0) continue;
      const title = /^#\s+(.+)$/.exec(line);
      if (title) return flattenSummary(title[1]) || null;
      if (NOT_PROSE.test(line)) continue;
      return flattenSummary(line) || null;
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** Static lookup so an unrecognised CLI status still maps to a rendered label. */
const KNOWN_STATUS: Record<string, ChangeStatus> = {
  "no-tasks": "no-tasks",
  "in-progress": "in-progress",
  complete: "complete",
};

export type DocumentRead =
  | { status: "ok"; content: string; bytes: number; truncated: boolean }
  | { status: "missing" }
  | { status: "denied"; message: string };

/** One change as the CLI reported it, before its documents are inspected. */
export interface ChangeInput {
  id: string;
  completedTasks: number;
  totalTasks: number;
  status: string;
  lastModified: string;
}

/** True when `id` can name a directory directly under `openspec/changes`. */
export function isChangeId(id: string): boolean {
  return (
    id.length > 0 &&
    id !== "." &&
    id !== ".." &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes("\0")
  );
}

/** True when `target` is the root itself or sits below it. */
function inside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * A regular file that, after resolving symlinks, still lives under `root`.
 *
 * Listing, summary extraction, and reading all go through this, so a link
 * planted in a change directory is neither shown nor followed.
 */
async function resolveFileInside(file: string, root: string): Promise<string | null> {
  const real = await realpath(file).catch(() => null);
  if (real === null || !inside(root, real)) return null;
  const info = await stat(real).catch(() => null);
  return info !== null && info.isFile() ? real : null;
}

/** Spec directory ids of one change that carry a `spec.md`, sorted by id. */
async function specIds(changeDir: string, root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(path.join(changeDir, "specs"), { withFileTypes: true });
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isChangeId(entry.name)) continue;
    const specFile = path.join(changeDir, "specs", entry.name, "spec.md");
    if ((await resolveFileInside(specFile, root)) !== null) ids.push(entry.name);
  }
  return ids.sort((left, right) => left.localeCompare(right));
}

/** Summary of one change: task progress plus the documents the panel can open. */
export async function describeChange(
  openspecDir: string,
  input: ChangeInput,
): Promise<ChangeSummary> {
  const { completedTasks, totalTasks } = input;
  const progress = {
    id: input.id,
    summary: null,
    completedTasks,
    totalTasks,
    status:
      KNOWN_STATUS[input.status] ??
      (totalTasks <= 0 ? "no-tasks" : completedTasks >= totalTasks ? "complete" : "in-progress"),
    lastModified: input.lastModified,
    documents: [],
  } satisfies ChangeSummary;
  const root = await realpath(openspecDir).catch(() => null);
  if (root === null) return progress;
  const changeDir = path.join(root, "changes", input.id);
  const documents: ChangeDocument[] = [];
  let summary: string | null = null;
  for (const entry of CHANGE_FILES) {
    const file = await resolveFileInside(path.join(changeDir, entry.file), root);
    // The summary comes from the same validated path the tab would open.
    if (entry.kind === "proposal" && file !== null) summary = await readSummary(file);
    documents.push({
      kind: entry.kind,
      label: entry.file,
      path: `changes/${input.id}/${entry.file}`,
      specId: null,
      exists: file !== null,
    });
  }
  for (const specId of await specIds(changeDir, root)) {
    documents.push({
      kind: "spec",
      label: specId,
      path: `changes/${input.id}/specs/${specId}/spec.md`,
      specId,
      exists: true,
    });
  }
  return { ...progress, summary, documents };
}

/**
 * Reads one document handed out by `describeChange`.
 *
 * The path must stay under `changes/` and, after resolving symlinks, under the
 * OpenSpec root, so a link planted in a change directory cannot reach out of it.
 * Only the first `MAX_DOCUMENT_BYTES` of a large document are returned.
 */
export async function readDocument(openspecDir: string, relPath: string): Promise<DocumentRead> {
  if (!DOCUMENT_PATH.test(relPath)) {
    return { status: "denied", message: "只允许读取变更目录内的 Markdown 文档。" };
  }
  const segments = relPath.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      return { status: "denied", message: "文档路径不合法。" };
    }
  }
  const root = await realpath(openspecDir).catch(() => null);
  if (root === null) return { status: "missing" };
  const target = path.resolve(root, ...segments);
  if (!inside(root, target)) {
    return { status: "denied", message: "文档超出 OpenSpec 目录。" };
  }
  let stats: Stats;
  try {
    stats = await stat(target);
  } catch {
    return { status: "missing" };
  }
  if (!stats.isFile()) return { status: "denied", message: "只允许读取普通文件。" };
  const real = await realpath(target).catch(() => null);
  if (real === null) return { status: "missing" };
  if (!inside(root, real)) {
    return { status: "denied", message: "文档符号链接指向 OpenSpec 目录之外。" };
  }
  const limit = Math.min(stats.size, MAX_DOCUMENT_BYTES);
  const handle = await open(real, "r");
  try {
    const buffer = Buffer.alloc(limit);
    let offset = 0;
    while (offset < limit) {
      const { bytesRead } = await handle.read(buffer, offset, limit - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return {
      status: "ok",
      content: buffer.subarray(0, offset).toString("utf8").replace(/^\uFEFF/, ""),
      bytes: stats.size,
      truncated: stats.size > offset,
    };
  } finally {
    await handle.close();
  }
}
