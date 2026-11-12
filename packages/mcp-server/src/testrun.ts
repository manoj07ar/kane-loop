import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { appendEvent } from "./events.js";
import type { RunOptions } from "./kane.js";

/**
 * Replays saved Kane flows (*_test.md) with `kane-cli testrun run --agent`.
 * Replays of authored flows cost 0 credits, so this is what the stop hook and
 * agents should call after every change. Event shapes follow kane-cli 0.10.x:
 * testrun_start, testrun_member_start/end, testrun_summary, testrun_done.
 */

export type ReplayStatus = "pass" | "fail" | "cancelled" | "not_started" | "error";

export interface ReplayInput {
  paths?: string[];
  match?: string;
  tags?: string[];
  failFast?: boolean;
  timeout?: number;
}

export interface ReplayMember {
  path: string;
  test_id?: string;
  status: string;
  duration_s?: number;
  failure?: { message: string; step_index?: number };
  log_path?: string;
  session_id?: string;
}

export interface ReplayResult {
  status: ReplayStatus;
  exit_code: number | null;
  execution_id?: string;
  overall_status?: string;
  totals?: Record<string, number>;
  duration_s?: number;
  members: ReplayMember[];
  failed: ReplayMember[];
  summary: string;
}

export const DEFAULT_REPLAY_TIMEOUT = 600;

export function buildReplayArgs(input: ReplayInput): string[] {
  const args = ["testrun", "run", ...(input.paths ?? []), "--agent", "--on-failure", input.failFast ? "fail-fast" : "continue"];
  if (input.match) args.push("--match", input.match);
  if (input.tags?.length) args.push("--tags", input.tags.join(","));
  return args;
}

export function replayExitToStatus(code: number | null): ReplayStatus {
  switch (code) {
    case 0: return "pass";
    case 1: return "fail";
    case 2: return "not_started";
    case 3: return "cancelled";
    default: return "error";
  }
}

type Json = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const n = (v: unknown) => (typeof v === "number" ? v : undefined);

function toMember(o: Json): ReplayMember {
  const f = o.failure as Json | undefined;
  return {
    path: s(o.path) ?? "?",
    test_id: s(o.test_id),
    status: s(o.status) ?? "unknown",
    duration_s: n(o.duration_s),
    failure: f && s(f.message) ? { message: f.message as string, step_index: n(f.step_index) } : undefined,
    log_path: s(o.log_path),
    session_id: s(o.session_id),
  };
}

export async function replayTests(input: ReplayInput = {}, opts: RunOptions = {}): Promise<ReplayResult> {
  const bin = opts.bin ?? process.env.KANE_CLI_BIN ?? "kane-cli";
  const eventsDir = opts.eventsDir ?? process.cwd();
  const timeout = input.timeout ?? DEFAULT_REPLAY_TIMEOUT;
  const emit = (event: Json) => appendEvent(eventsDir, { source: "mcp-server", ...event }).catch(() => {});
  const members: ReplayMember[] = [];
  let summary: Json | undefined;
  let done: Json | undefined;
  let start: Json | undefined;
  let stderr = "";

  await emit({ type: "replay_start", paths: input.paths, match: input.match, tags: input.tags });

  const handle = async (line: string) => {
    const t = line.trim();
    if (!t) return;
    let o: Json;
    try { o = JSON.parse(t) as Json; } catch { return; }
    if (o.type === "testrun_member_event") return; // member streams stay in their own log files
    await emit({ type: "kane_event", event: o });
    if (o.type === "testrun_start") start = o;
    else if (o.type === "testrun_member_end" || o.type === "testrun_authored_member_end") members.push(toMember(o));
    else if (o.type === "testrun_summary") summary = o;
    else if (o.type === "testrun_done") done = o;
  };

  const exitCode = await new Promise<number | null>((resolve) => {
    let child;
    try {
      child = spawn(bin, buildReplayArgs(input), { cwd: opts.cwd ?? eventsDir, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { stderr += String(e); resolve(null); return; }
    let buf = "";
    let chain = Promise.resolve();
    let killed = false;
    const watchdog = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, (timeout + 30) * 1000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        chain = chain.then(() => handle(line));
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => { stderr += c; });
    child.on("error", (e) => { stderr += String(e); clearTimeout(watchdog); chain.then(() => resolve(null)); });
    child.on("close", (code) => {
      clearTimeout(watchdog);
      if (buf.trim()) chain = chain.then(() => handle(buf));
      chain.then(() => resolve(killed ? 3 : code));
    });
  });

  const status = replayExitToStatus(exitCode);
  const failed = members.filter((m) => m.status !== "passed" && m.status !== "skipped");
  const totals = summary?.totals as Record<string, number> | undefined;
  const text = status === "pass"
    ? `All ${members.length} saved flow(s) passed.`
    : status === "fail"
      ? `${failed.length} of ${members.length} saved flow(s) failed: ` + failed.map((m) => `${m.path} (${m.failure?.message ?? m.status})`).join("; ")
      : status === "cancelled" ? "Replay was cancelled or timed out."
        : (stderr.trim().slice(0, 500) || `kane-cli exited with ${exitCode}`);

  const result: ReplayResult = {
    status,
    exit_code: exitCode,
    execution_id: s(done?.execution_id) ?? s(start?.execution_id),
    overall_status: s(done?.overall_status),
    totals,
    duration_s: n(summary?.duration_s),
    members,
    failed,
    summary: text,
  };
  await emit({ type: "replay_end", status, exit_code: exitCode, failed: failed.map((m) => ({ path: m.path, message: m.failure?.message })) });
  return result;
}

export interface FailureDetail {
  log_path: string;
  failed_step?: number;
  heading?: string;
  message?: string;
  remarks: string[];
  screenshots: string[];
}

/** Reads one member's events.ndjson and pulls out what an agent needs to fix the failure. */
export async function getFailure(logPath: string): Promise<FailureDetail> {
  const raw = await readFile(logPath, "utf8");
  const headings = new Map<number, string>();
  const remarks: string[] = [];
  const screenshots = new Set<string>();
  let failedStep: number | undefined;
  let message: string | undefined;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o: Json;
    try { o = JSON.parse(line) as Json; } catch { continue; }
    if (o.type === "test_md_step_start" && typeof o.step_index === "number" && s(o.heading)) headings.set(o.step_index, (o.heading as string).trim());
    else if (o.type === "test_md_step_end" && o.status === "failed" && typeof o.step_index === "number") failedStep = o.step_index;
    else if (o.type === "run_end" && o.status !== "passed") message = s(o.reason) ?? s(o.summary) ?? message;
    else if (o.type === "error") message = s(o.message) ?? message;
    if (s(o.remark)) remarks.push(o.remark as string);
    for (const k of ["screenshot", "screenshot_path", "image_path"]) if (s(o[k])) screenshots.add(o[k] as string);
  }
  return {
    log_path: logPath,
    failed_step: failedStep,
    heading: failedStep !== undefined ? headings.get(failedStep) : undefined,
    message: message ?? (failedStep !== undefined ? `step ${failedStep} failed` : undefined),
    remarks: remarks.slice(-5),
    screenshots: [...screenshots],
  };
}
