import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Task state the CLI reports for one change. */
export const ChangeStatusSchema = z.enum(["no-tasks", "in-progress", "complete"]);

/** Which OpenSpec artifact a document is. */
export const DocumentKindSchema = z.enum(["proposal", "design", "tasks", "spec"]);

export const ChangeDocumentSchema = z.object({
  kind: DocumentKindSchema,
  /** File name for the three artifacts, or the spec directory id for `kind: "spec"`. */
  label: z.string(),
  /** Path relative to the OpenSpec root, always with forward slashes. */
  path: z.string(),
  /** Spec directory id, only set for `kind: "spec"`. */
  specId: z.string().nullable(),
  /**
   * Whether the file is there to read. The three artifacts are always listed so
   * the panel can show a disabled tab for one that has not been written yet.
   */
  exists: z.boolean(),
});

export const ChangeSummarySchema = z.object({
  /** Change id, as it appears under `openspec/changes`. */
  id: z.string(),
  /**
   * One-line orientation for the change: its `#` heading when the proposal has
   * one, otherwise the first prose paragraph.
   */
  summary: z.string().nullable(),
  completedTasks: z.number(),
  totalTasks: z.number(),
  status: ChangeStatusSchema,
  /** ISO timestamp of the newest file in the change directory, empty when unknown. */
  lastModified: z.string(),
  documents: z.array(ChangeDocumentSchema),
});

/** Listing one workspace, as produced by `openspec-cn list --json`. */
export const listRpc = defineRpc({
  name: "openspec.list",
  input: z.object({
    /** Absolute workspace directory the CLI runs in. */
    directory: z.string().min(1),
  }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      /** Project root the CLI selected — the parent of `openspec/`. */
      root: z.string(),
      /** How the CLI picked that root, for example `nearest` or `declared`. */
      source: z.string(),
      /** Absolute `openspec/` directory the documents come from. */
      openspecDir: z.string(),
      changes: z.array(ChangeSummarySchema),
    }),
    /** No OpenSpec root above the workspace directory. */
    z.object({
      status: z.literal("missing"),
      message: z.string(),
    }),
    /** The CLI is not installed where the daemon can find it. */
    z.object({
      status: z.literal("cli-missing"),
      message: z.string(),
      /** Directories that were searched, so the user can see what to fix. */
      searched: z.array(z.string()),
    }),
    z.object({
      status: z.literal("error"),
      message: z.string(),
    }),
  ]),
});

/** Reading one document of one change. */
export const documentRpc = defineRpc({
  name: "openspec.document",
  input: z.object({
    directory: z.string().min(1),
    /** OpenSpec-root-relative path, as handed out by `openspec.list`. */
    path: z.string().min(1),
  }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      content: z.string(),
      /** Size of the file on disk, which may exceed `content`. */
      bytes: z.number(),
      /** True when only the first slice of a large document was sent. */
      truncated: z.boolean(),
    }),
    z.object({ status: z.literal("missing") }),
    z.object({
      status: z.literal("denied"),
      message: z.string(),
    }),
    z.object({
      status: z.literal("error"),
      message: z.string(),
    }),
  ]),
});

export type ChangeStatus = z.infer<typeof ChangeStatusSchema>;
export type DocumentKind = z.infer<typeof DocumentKindSchema>;
export type ChangeDocument = z.infer<typeof ChangeDocumentSchema>;
export type ChangeSummary = z.infer<typeof ChangeSummarySchema>;
export type ListResult = z.infer<typeof listRpc.output>;
export type DocumentResult = z.infer<typeof documentRpc.output>;

/** Largest document the panel renders, in bytes. Mirrored by the server. */
export const MAX_DOCUMENT_BYTES = 512 * 1024;
