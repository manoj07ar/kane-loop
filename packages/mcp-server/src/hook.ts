import { appendEvent } from "./events.js";
import { verifyWithKane, type RunOptions, type VerifyResult } from "./kane.js";
import { computeStatus, loadConfig, readEvents, type Json } from "./loop.js";

export type AgentKind = "claude" | "cursor";

export interface HookOutcome {
  result: "green" | "red" | "gave_up" | "skipped";
  iteration: number;
  /** JSON to print on stdout for the agent's hook runner, or undefined to print nothing (allow stop). */
  output?: Json;
  message?: string;
  failures: { objective: string; url: string; result: VerifyResult }[];
}

export function feedback(failures: HookOutcome["failures"], iteration: number, max: number): string {
  const lines = [`Kane Loop: Kane CLI ran your app in a real browser after your turn and ${failures.length} flow(s) failed (attempt ${iteration} of ${max}).`];
  for (const f of failures) {
    const r = f.result;
    const where = r.failed_step !== undefined ? `step ${r.failed_step} failed` : r.status;
    lines.push(`- Flow "${f.objective}" on ${f.url}: ${where}${r.remark ? `: ${r.remark}` : ""}${r.summary ? ` (${r.summary})` : ""}${r.test_url ? `. Evidence: ${r.test_url}` : ""}`);
  }
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
 * Stop-hook entry: replay the configured flows; on failure, block the agent's stop and hand it Kane's remarks.
 * `input` is the JSON the agent's hook runner wrote on stdin (Claude Code Stop hook or Cursor stop hook).
 */
export async function runStopHook(agent: AgentKind, input: Json, dir: string, opts: RunOptions = {}): Promise<HookOutcome> {
  const cfg = await loadConfig(dir);
  const emit = (e: Json) => appendEvent(dir, { source: `hook:${agent}`, ...e });
  if (cfg.flows.length === 0) return { result: "skipped", iteration: 0, failures: [], message: "no flows in .kane-loop.json" };

  // Cursor reports a non-completed turn (aborted/error): don't re-prompt.
  if (agent === "cursor" && typeof input.status === "string" && input.status !== "completed") {
    return { result: "skipped", iteration: 0, failures: [], message: `turn status ${input.status}` };
  }

  const prev = computeStatus(await readEvents(dir));
  const prevIteration = prev.state === "red" ? prev.iteration : 0;

  const failures: HookOutcome["failures"] = [];
  for (const flow of cfg.flows) {
    const result = await verifyWithKane(flow, { ...opts, eventsDir: dir });
    if (result.status !== "pass") failures.push({ objective: flow.objective, url: flow.url, result });
  }

  if (failures.length === 0) {
    await emit({ type: "loop_iteration", result: "green", iteration: 0, flows: cfg.flows.length });
    return { result: "green", iteration: 0, failures };
  }

  // Cursor tells us how many follow-ups it already auto-submitted this conversation; trust the larger count.
  const cursorLoops = agent === "cursor" && typeof input.loop_count === "number" ? input.loop_count : 0;
  const iteration = Math.max(prevIteration, cursorLoops) + 1;
  // Kane couldn't start (credits/login) is not the agent's bug: surface it but don't loop on it.
  const infra = failures.every((f) => f.result.status === "not_started" || f.result.status === "error");
  if (iteration > cfg.maxIterations || infra) {
    await emit({ type: "loop_iteration", result: "gave_up", iteration, reason: infra ? "kane_unavailable" : "max_iterations" });
    return { result: "gave_up", iteration, failures, message: infra ? "Kane CLI could not run (check kane-cli login / balance)." : `Still red after ${cfg.maxIterations} attempts; handing back to you.` };
  }

  const message = feedback(failures, iteration, cfg.maxIterations);
  await emit({ type: "loop_iteration", result: "red", iteration, failed: failures.map((f) => ({ objective: f.objective, failed_step: f.result.failed_step, remark: f.result.remark })) });
  const output: Json = agent === "claude" ? { decision: "block", reason: message } : { followup_message: message };
  return { result: "red", iteration, failures, output, message };
}
