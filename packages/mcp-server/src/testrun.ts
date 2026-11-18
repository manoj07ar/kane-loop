import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
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

/**
 * kane-cli 0.10.x `testrun run` only takes *_test.md files ("error: not a *_test.md file: .testmuai/tests"),
 * so folders are expanded here to the saved flows inside them (recursively, sorted). Paths that don't exist,
 * or folders with no flows, are passed through so kane-cli reports them.
 */
export async function expandTestPaths(paths: string[] | undefined, cwd: string): Promise<string[] | undefined> {
  if (!paths?.length) return paths;
  const out: string[] = [];
  const walk = async (abs: string, rel: string): Promise<string[]> => {
    const found: string[] = [];
    for (const e of (await readdir(abs, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) found.push(...(await walk(join(abs, e.name), join(rel, e.name))));
      else if (e.isFile() && e.name.endsWith("_test.md")) found.push(join(rel, e.name));
    }
    return found;
  };
  for (const p of paths) {
    let isDir = false;
    try { isDir = (await stat(resolve(cwd, p))).isDirectory(); } catch { /* let kane-cli report it */ }
    const files = isDir ? await walk(resolve(cwd, p), p) : [];
    out.push(...(files.length ? files : [p]));
  }
  return out;
}

/** kane-cli prints update notices on stderr even in --agent mode; drop them from error summaries. */
export function cleanStderr(text: string): string {
  return text.split("\n").filter((l) => !/^\s*(Skill update available|Update available)\b/.test(l)).join("\n").trim();
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

  const cwd = opts.cwd ?? eventsDir;
  const paths = await expandTestPaths(input.paths, cwd);
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
      child = spawn(bin, buildReplayArgs({ ...input, paths }), { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
        : (cleanStderr(stderr).slice(0, 500) || `kane-cli exited with ${exitCode}`);

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
  /** test_md step (the "## Step N" section of the saved flow) that failed. */
  failed_step?: number;
  heading?: string;
  /** Kane action index inside that step (step_end.index), e.g. the failing assert. */
  failed_action?: number;
  message?: string;
  /** Kane's own description of the failing action (assertion text or step summary), when the log has one. */
  detail?: string;
  remarks: string[];
  screenshots: string[];
  /** Kane checks (run_end context variables) that came back "false". */
  failed_checks: string[];
}

/**
 * Reads one member's events.ndjson and pulls out what an agent needs to fix the failure.
 * Real kane-cli 0.10.3 replay logs carry the failing assertion as step_event {event:"assertion", detail, passed:false}
 * and step_end {index, status:"failed", summary}; run_end has reason "assertion_failed: @ step N", an absolute
 * screenshot_path and context.variables whose value is "false" for each failed check. step_end.screenshot is a bare
 * file name ("screenshot.jpg"), so only absolute screenshot paths are kept.
 */
export async function getFailure(logPath: string): Promise<FailureDetail> {
  const raw = await readFile(logPath, "utf8");
  const headings = new Map<number, string>();
  const remarks: string[] = [];
  const screenshots = new Set<string>();
  const failedChecks: string[] = [];
  let failedStep: number | undefined;
  let failedAction: number | undefined;
  let failedAssertion: string | undefined;
  let failedSummary: string | undefined;
  let message: string | undefined;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o: Json;
    try { o = JSON.parse(line) as Json; } catch { continue; }
    if (o.type === "test_md_step_start" && typeof o.step_index === "number" && s(o.heading)) headings.set(o.step_index, (o.heading as string).trim());
    else if (o.type === "test_md_step_end" && o.status === "failed" && typeof o.step_index === "number") failedStep = o.step_index;
    else if (o.type === "step_event" && o.event === "assertion" && o.passed === false && s(o.detail)) {
      failedAssertion = o.detail as string;
      remarks.push(`Assertion failed: ${failedAssertion}`);
    } else if (o.type === "step_end" && o.status === "failed") {
      if (typeof o.index === "number") failedAction = o.index;
      failedSummary = s(o.summary) ?? failedSummary;
    } else if (o.type === "run_end" && o.status !== "passed") {
      message = s(o.reason) ?? s(o.summary) ?? message;
      const vars = (o.context as Json | undefined)?.variables as Record<string, Json> | undefined;
      for (const [k, v] of Object.entries(vars ?? {})) if (v && v.value === "false") failedChecks.push(k);
    } else if (o.type === "error") message = s(o.message) ?? message;
    if (s(o.remark)) remarks.push(o.remark as string);
    for (const k of ["screenshot", "screenshot_path", "image_path"]) if (s(o[k]) && isAbsolute(o[k] as string)) screenshots.add(o[k] as string);
  }
  let detail: string | undefined;
  if (failedAssertion || failedSummary) {
    const what = failedAssertion ? `assertion failed: ${failedAssertion}` : `${failedSummary} failed`;
    detail = message = failedAction !== undefined ? `Kane action ${failedAction}: ${what}` : what;
  }
  if (failedChecks.length) remarks.push(`Checks that came back false: ${failedChecks.join(", ")}`);
  return {
    log_path: logPath,
    failed_step: failedStep,
    heading: failedStep !== undefined ? headings.get(failedStep) : undefined,
    failed_action: failedAction,
    message: message ?? (failedStep !== undefined ? `step ${failedStep} failed` : undefined),
    detail,
    remarks: remarks.slice(-5),
    screenshots: [...screenshots],
    failed_checks: failedChecks,
  };
}
