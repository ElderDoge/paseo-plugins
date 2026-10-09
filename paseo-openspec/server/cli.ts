import { execFile } from "node:child_process";
import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Binary names this plugin accepts, most specific first. The simplified-Chinese
 * package ships `openspec-cn`; the upstream package ships `openspec`.
 */
const CLI_NAMES = ["openspec-cn", "openspec"] as const;

/** How long one `list --json` run may take. */
const LIST_TIMEOUT_MS = 20_000;
/** Output cap for one run; a large project's JSON stays far below this. */
const LIST_MAX_BYTES = 32 * 1024 * 1024;

export interface CliLocation {
  /** Absolute path of the executable. */
  command: string;
  /** Directory holding it, which is also the PATH entry its `node` shebang needs. */
  binDir: string;
}

/** Kept after the first successful lookup; a miss is retried on the next call. */
let cached: CliLocation | null = null;

/**
 * Every directory the CLI is looked for in, in search order and without repeats.
 *
 * The daemon is often started from the app bundle, where nvm never touched
 * `PATH`, so the well-known install roots are searched after the daemon's own.
 */
export function searchDirs(): string[] {
  const home = homedir();
  const nvmDir = process.env.NVM_DIR ?? path.join(home, ".nvm");
  const versionsDir = path.join(nvmDir, "versions", "node");
  let nvmBins: string[] = [];
  try {
    // Newest node first: a globally installed CLI lives in the newest version.
    nvmBins = readdirSync(versionsDir)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .reverse()
      .map((version) => path.join(versionsDir, version, "bin"));
  } catch {
    nvmBins = [];
  }
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => dir.length > 0);
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of [
    ...fromPath,
    ...nvmBins,
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, "Library", "pnpm"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ]) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }
  return dirs;
}

/** Absolute CLI to run, or null when neither binary name is installed. */
export function resolveCli(): CliLocation | null {
  if (cached) return cached;
  for (const dir of searchDirs()) {
    for (const name of CLI_NAMES) {
      const file = path.join(dir, name);
      try {
        accessSync(file, constants.X_OK);
      } catch {
        continue;
      }
      cached = { command: file, binDir: dir };
      return cached;
    }
  }
  return null;
}

export interface ListRun {
  stdout: string;
  stderr: string;
  /** Exit code, or null when the process was killed instead of exiting. */
  code: number | null;
  /** True when the run was killed by the timeout. */
  timedOut: boolean;
  /** Node-level failure code such as `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. */
  failure: string | null;
}

/**
 * Runs `openspec-cn list --json` in `directory`.
 *
 * Only rejects when the process cannot be started at all; a non-zero exit, a
 * timeout, and a buffer overflow all resolve, because the CLI reports some
 * failures as JSON on stdout together with a non-zero exit code.
 */
export function spawnList(location: CliLocation, directory: string): Promise<ListRun> {
  const { promise, resolve, reject } = Promise.withResolvers<ListRun>();
  execFile(
    location.command,
    ["list", "--json"],
    {
      cwd: directory,
      timeout: LIST_TIMEOUT_MS,
      maxBuffer: LIST_MAX_BYTES,
      // The CLI is a `#!/usr/bin/env node` script, so its own directory has to
      // be on PATH for the shebang to find the node that installed it.
      env: { ...process.env, PATH: [location.binDir, ...searchDirs()].join(path.delimiter) },
      windowsHide: true,
    },
    (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
        reject(error);
        return;
      }
      resolve({
        stdout,
        stderr,
        code: typeof code === "number" ? code : 0,
        timedOut: Boolean((error as { killed?: boolean } | null)?.killed),
        failure: typeof code === "string" ? code : null,
      });
    },
  );
  return promise;
}

/** First non-empty line of `text`, trimmed and short enough to render in a panel. */
export function firstLine(text: string, limit = 300): string {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return "";
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}
