import { appendEvent } from "./events.js";
import { verifyWithKane, type RunOptions, type VerifyResult } from "./kane.js";
import { computeStatus, loadConfig, readEvents, resolveReplay, type Json } from "./loop.js";
import { getFailure, replayTests, type ReplayMember } from "./testrun.js";

export type AgentKind = "claude" | "cursor";

export interface HookOutcome {
  result: "green" | "red" | "gave_up" | "skipped";
  iteration: number;
  /** JSON to print on stdout for the agent's hook runner, or undefined to print nothing (allow stop). */
  output?: Json;
  message?: string;
  /** "replay" = saved *_test.md flows via kane-cli testrun (0 credits); "live" = kane-cli run per configured flow. */
  mode?: "replay" | "live";
  failures: HookFailure[];
}

export type HookFailure =
  | { kind: "live"; objective: string; url: string; result: VerifyResult }
  | { kind: "replay"; path: string; member: ReplayMember; heading?: string; remarks?: string[]; screenshots?: string[] };

/** Turns a failed replay member into a hook failure, enriched from its event log when kane-cli wrote one. */
async function replayFailure(member: ReplayMember): Promise<HookFailure> {
  const f: HookFailure = { kind: "replay", path: member.path, member };
  if (!member.log_path) return f;
  try {
    const d = await getFailure(member.log_path);
    return { ...f, heading: d.heading, remarks: d.remarks, screenshots: d.screenshots };
  } catch {
    return f;
  }
}

function describeFailure(f: HookFailure): string {
  if (f.kind === "live") {
    const r = f.result;
    const where = r.failed_step !== undefined ? `step ${r.failed_step} failed` : r.status;
    return `- Flow "${f.objective}" on ${f.url}: ${where}${r.remark ? `: ${r.remark}` : ""}${r.summary ? ` (${r.summary})` : ""}${r.test_url ? `. Evidence: ${r.test_url}` : ""}`;
  }
  const m = f.member;
  const step = m.failure?.step_index;
  const where = step !== undefined ? `step ${step}${f.heading ? ` ("${f.heading}")` : ""} failed` : m.status;
  const extra = f.remarks?.filter((r) => r !== m.failure?.message).slice(-2) ?? [];
  return `- Saved flow ${f.path}: ${where}${m.failure?.message ? `: ${m.failure.message}` : ""}${extra.length ? `. Kane noted: ${extra.join(" / ")}` : ""}${f.screenshots?.length ? `. Screenshot: ${f.screenshots[f.screenshots.length - 1]}` : ""}${m.log_path ? `. Log: ${m.log_path}` : ""}`;
}

export function feedback(failures: HookFailure[], iteration: number, max: number): string {
  const lines = [`Kane Loop: Kane CLI ran your app in a real browser after your turn and ${failures.length} flow(s) failed (attempt ${iteration} of ${max}).`];
  for (const f of failures) lines.push(describeFailure(f));
  lines.push("Fix the app code so these flows pass. Don't weaken, skip or edit the Kane flows. When you finish your turn, Kane will re-run them.");
  return lines.join("\n");
}

/**
 * Which repo the hook should read `.kane-loop.json` from. Claude Code sends `cwd` on stdin; Cursor sends
 * `workspace_roots` and sets CURSOR_PROJECT_DIR (Claude-compat alias CLAUDE_PROJECT_DIR). KANE_LOOP_DIR overrides all.
 */
export function resolveDir(input: Json, env: NodeJS.ProcessEnv = process.env, fallback: string = process.cwd()): string {
  if (env.KANE_LOOP_DIR) return env.KANE_LOOP_DIR;
  if (typeof input.cwd === "string" && input.cwd) return input.cwd;
  const roots = input.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0]) return roots[0];
  return env.CURSOR_PROJECT_DIR || env.CLAUDE_PROJECT_DIR || fallback;
}

/**
 * Stop-hook entry: replay saved Kane flows (0 credits) or, if none, run the configured live flows; on failure, block the agent's stop and hand it Kane's remarks.
 * `input` is the JSON the agent's hook runner wrote on stdin (Claude Code Stop hook or Cursor stop hook).
 */
export async function runStopHook(agent: AgentKind, input: Json, dir: string, opts: RunOptions = {}): Promise<HookOutcome> {
  const cfg = await loadConfig(dir);
  const emit = (e: Json) => appendEvent(dir, { source: `hook:${agent}`, ...e });
  // Cursor reports a non-completed turn (aborted/error): don't re-prompt.
  if (agent === "cursor" && typeof input.status === "string" && input.status !== "completed") {
    return { result: "skipped", iteration: 0, failures: [], message: `turn status ${input.status}` };
  }

  const prev = computeStatus(await readEvents(dir));
  const prevIteration = prev.state === "red" ? prev.iteration : 0;

  // Prefer replaying saved flows: 0 credits and deterministic. Fall back to live runs of configured flows.
  const replay = await resolveReplay(dir, cfg);
  const mode: "replay" | "live" = replay ? "replay" : "live";
  const failures: HookFailure[] = [];
  let ran = 0;
  let infraOnly = false;
  if (replay) {
    const r = await replayTests(replay, { ...opts, eventsDir: dir, cwd: opts.cwd ?? dir });
    ran = r.members.length;
    if (r.status === "not_started" || r.status === "error" || r.status === "cancelled") {
      await emit({ type: "loop_iteration", result: "gave_up", iteration: prevIteration + 1, mode, reason: "kane_unavailable" });
      return { result: "gave_up", iteration: prevIteration + 1, mode, failures, message: `Kane CLI could not replay the saved flows (check kane-cli login / balance): ${r.summary}` };
    }
    for (const m of r.failed) failures.push(await replayFailure(m));
    if (r.status === "fail" && failures.length === 0) {
      failures.push({ kind: "replay", path: "(testrun)", member: { path: "(testrun)", status: "failed", failure: { message: r.summary } } });
    }
  } else {
    if (cfg.flows.length === 0) return { result: "skipped", iteration: 0, failures: [], message: "no flows in .kane-loop.json and no saved flows" };
    for (const flow of cfg.flows) {
      const result = await verifyWithKane(flow, { ...opts, eventsDir: dir });
      ran++;
      if (result.status !== "pass") failures.push({ kind: "live", objective: flow.objective, url: flow.url, result });
    }
    infraOnly = failures.length > 0 && failures.every((f) => f.kind === "live" && (f.result.status === "not_started" || f.result.status === "error"));
  }

  if (failures.length === 0) {
    await emit({ type: "loop_iteration", result: "green", iteration: 0, mode, flows: ran });
    return { result: "green", iteration: 0, mode, failures };
  }

  // Cursor tells us how many follow-ups it already auto-submitted this conversation; trust the larger count.
  const cursorLoops = agent === "cursor" && typeof input.loop_count === "number" ? input.loop_count : 0;
  const iteration = Math.max(prevIteration, cursorLoops) + 1;
  // Kane couldn't start (credits/login) is not the agent's bug: surface it but don't loop on it.
  const infra = infraOnly;
  if (iteration > cfg.maxIterations || infra) {
    await emit({ type: "loop_iteration", result: "gave_up", iteration, mode, reason: infra ? "kane_unavailable" : "max_iterations" });
    return { result: "gave_up", iteration, mode, failures, message: infra ? "Kane CLI could not run (check kane-cli login / balance)." : `Still red after ${cfg.maxIterations} attempts; handing back to you.` };
  }

  const message = feedback(failures, iteration, cfg.maxIterations);
  await emit({
    type: "loop_iteration", result: "red", iteration, mode,
    failed: failures.map((f) => f.kind === "live"
      ? { objective: f.objective, failed_step: f.result.failed_step, remark: f.result.remark }
      : { path: f.path, failed_step: f.member.failure?.step_index, remark: f.member.failure?.message, heading: f.heading, screenshot: f.screenshots?.[f.screenshots.length - 1] }),
  });
  const output: Json = agent === "claude" ? { decision: "block", reason: message } : { followup_message: message };
  return { result: "red", iteration, mode, failures, output, message };
}
