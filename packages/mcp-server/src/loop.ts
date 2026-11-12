import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eventsPath } from "./events.js";
import type { VerifyInput } from "./kane.js";

export type Json = Record<string, unknown>;

export interface Flow extends VerifyInput {}

export interface LoopConfig {
  /** Flows replayed after every agent turn. */
  flows: Flow[];
  /** Max consecutive red iterations before the hook stops blocking. */
  maxIterations: number;
}

export const DEFAULT_MAX_ITERATIONS = 3;

export async function readEvents(dir: string): Promise<Json[]> {
  let text: string;
  try {
    text = await readFile(eventsPath(dir), "utf8");
  } catch {
    return [];
  }
  const out: Json[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as Json); } catch { /* skip torn line */ }
  }
  return out;
}

export async function loadConfig(dir: string): Promise<LoopConfig> {
  let raw: Json = {};
  try {
    raw = JSON.parse(await readFile(join(dir, ".kane-loop.json"), "utf8")) as Json;
  } catch { /* no config: no flows */ }
  const flows = Array.isArray(raw.flows) ? (raw.flows as Flow[]).filter((f) => f && typeof f.url === "string" && typeof f.objective === "string") : [];
  const max = typeof raw.maxIterations === "number" && raw.maxIterations > 0 ? raw.maxIterations : DEFAULT_MAX_ITERATIONS;
  return { flows, maxIterations: max };
}

export interface LoopStatus {
  state: "idle" | "verifying" | "green" | "red" | "gave_up";
  /** Consecutive red loop iterations since the last green (0 when green/idle). */
  iteration: number;
  total_runs: number;
  passes: number;
  fails: number;
  last?: { status: unknown; failed_step?: unknown; remark?: unknown; test_url?: unknown; ts?: unknown; name?: unknown };
}

/** Derive the loop's state purely from the event log, so every process (MCP server, hooks, console) agrees. */
export function computeStatus(events: Json[]): LoopStatus {
  let state: LoopStatus["state"] = "idle";
  let iteration = 0, total = 0, passes = 0, fails = 0;
  let last: LoopStatus["last"];
  let open = 0;
  for (const e of events) {
    switch (e.type) {
      case "verify_start": open++; state = "verifying"; break;
      case "verify_end":
        open = Math.max(0, open - 1);
        total++;
        if (e.status === "pass") passes++; else fails++;
        last = { status: e.status, failed_step: e.failed_step, remark: e.remark, test_url: e.test_url, ts: e.ts };
        if (open === 0 && state === "verifying") state = e.status === "pass" ? "green" : "red";
        break;
      case "loop_iteration":
        if (e.result === "green") { state = "green"; iteration = 0; }
        else if (e.result === "red") { state = "red"; iteration = typeof e.iteration === "number" ? e.iteration : iteration + 1; }
        else if (e.result === "gave_up") { state = "gave_up"; iteration = typeof e.iteration === "number" ? e.iteration : iteration; }
        break;
    }
  }
  if (open > 0) state = "verifying";
  return { state, iteration, total_runs: total, passes, fails, last };
}
