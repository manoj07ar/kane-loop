import { watch as fsWatch, type FSWatcher } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { appendEvent } from "./events.js";
import { feedback, runChecks, type HookFailure } from "./hook.js";
import type { RunOptions } from "./kane.js";
import { loadConfig } from "./loop.js";

/** Paths (relative to the repo) whose changes never trigger a Kane run. */
export const DEFAULT_IGNORE = ["node_modules", ".git", ".kane-loop", ".testmuai", "dist", "build", ".next", ".turbo", "coverage", "output-"];

export function shouldIgnore(rel: string, ignore: string[] = DEFAULT_IGNORE): boolean {
  if (!rel) return true;
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => ignore.some((i) => (i.endsWith("-") ? p.startsWith(i) : p === i)))) return true;
  const base = parts[parts.length - 1] ?? "";
  // Editor swap/backup files and our own log churn.
  return /(^\.#|~$|\.swp$|\.swx$|\.tmp$|^4913$)/.test(base) || base.endsWith(".log");
}

/** Collapses a burst of saves into one call; calls made while `fn` is running queue exactly one re-run. */
export function createDebouncer(fn: () => Promise<void>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  const fire = async () => {
    timer = undefined;
    if (running) { again = true; return; }
    running = true;
    try { await fn(); } finally {
      running = false;
      if (again) { again = false; schedule(); }
    }
  };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(fire, ms); };
  return { schedule, cancel: () => { if (timer) clearTimeout(timer); timer = undefined; }, get running() { return running; } };
}

export interface WatchRun {
  result: "green" | "red" | "unavailable" | "skipped";
  mode?: "replay" | "live";
  ran: number;
  failures: HookFailure[];
  message?: string;
  changed: string[];
}

export const LAST_FAILURE_FILE = join(".kane-loop", "last-failure.md");

/**
 * One on-save check. On red, writes Kane's feedback to `.kane-loop/last-failure.md` (the file an agent or
 * a human can read) and logs a `watch_run` event for the Loop Console. Never counts toward the stop hook's
 * iteration cap: only agent turns do.
 */
export async function runWatchCheck(dir: string, changed: string[], opts: RunOptions = {}): Promise<WatchRun> {
  const cfg = await loadConfig(dir);
  const checked = await runChecks(dir, cfg, opts);
  const failurePath = join(dir, LAST_FAILURE_FILE);
  let run: WatchRun;
  if (checked.kind === "none") run = { result: "skipped", ran: 0, failures: [], message: checked.message, changed };
  else if (checked.kind === "unavailable" || checked.infraOnly) {
    run = { result: "unavailable", mode: checked.mode, ran: checked.ran, failures: checked.failures, changed,
      message: checked.kind === "unavailable" ? checked.message : "Kane CLI could not run (check kane-cli login / balance)." };
  } else if (checked.failures.length === 0) run = { result: "green", mode: checked.mode, ran: checked.ran, failures: [], changed };
  else run = { result: "red", mode: checked.mode, ran: checked.ran, failures: checked.failures, changed,
    message: feedback(checked.failures, 1, 1).replace(/ \(attempt 1 of 1\)/, "").replace("after your turn", "after you saved") };

  if (run.result === "red") {
    await mkdir(join(dir, ".kane-loop"), { recursive: true });
    await writeFile(failurePath, `${run.message}\n\nChanged: ${changed.join(", ") || "(unknown)"}\n`);
  } else if (run.result === "green") {
    await rm(failurePath, { force: true });
  }
  await appendEvent(dir, { source: "watch", type: "watch_run", result: run.result, mode: run.mode, flows: run.ran, changed: changed.slice(0, 20),
    failed: run.failures.map((f) => f.kind === "live" ? { objective: f.objective, failed_step: f.result.failed_step, remark: f.result.remark } : { path: f.path, failed_step: f.member.failure?.step_index, remark: f.member.failure?.message }) });
  return run;
}

export interface WatchOptions extends RunOptions {
  debounceMs?: number;
  ignore?: string[];
  onRun?: (run: WatchRun) => void;
  onError?: (err: Error) => void;
}

/** Watches the repo and re-runs Kane after saves settle. Returns a handle to stop watching. */
export function startWatch(dir: string, opts: WatchOptions = {}): { close: () => void; trigger: (file: string) => void } {
  const { debounceMs = 1500, ignore = DEFAULT_IGNORE, onRun, onError, ...runOpts } = opts;
  let pending = new Set<string>();
  const deb = createDebouncer(async () => {
    const changed = [...pending].sort();
    pending = new Set();
    try { onRun?.(await runWatchCheck(dir, changed, runOpts)); } catch (e) { onError?.(e as Error); }
  }, debounceMs);
  const trigger = (file: string) => {
    const rel = file.split(sep).join("/");
    if (shouldIgnore(rel, ignore)) return;
    pending.add(rel);
    deb.schedule();
  };
  let watcher: FSWatcher | undefined;
  watcher = fsWatch(dir, { recursive: true }, (_event, name) => { if (name) trigger(String(name)); });
  watcher.on("error", (e) => onError?.(e));
  return { close: () => { deb.cancel(); watcher?.close(); watcher = undefined; }, trigger };
}
