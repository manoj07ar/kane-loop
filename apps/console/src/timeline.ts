export type Json = Record<string, unknown>;

export interface Step { step: number; status: string; remark?: string }

export interface Run {
  kind: "verify" | "replay";
  start: string;
  end?: string;
  label: string;
  status: "running" | "pass" | "fail" | "timeout" | "error" | string;
  steps: Step[];
  failed_step?: number;
  remark?: string;
  test_url?: string;
  failed?: { path?: string; message?: string }[];
}

export interface Iteration {
  ts: string;
  result: "green" | "red" | "gave_up" | string;
  iteration: number;
  source?: string;
  mode?: string;
  reason?: string;
  failed: { objective?: string; path?: string; failed_step?: unknown; remark?: unknown; heading?: unknown; screenshot?: unknown }[];
  runs: Run[];
}

export interface Timeline {
  iterations: Iteration[];
  /** Runs not yet closed by a loop_iteration (live, or a manual verify_with_kane call). */
  pending: Run[];
  state: "idle" | "verifying" | "green" | "red" | "gave_up";
  passes: number;
  fails: number;
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Fold the raw events.jsonl lines into loop iterations, each holding the Kane runs that led to it. */
export function buildTimeline(events: Json[]): Timeline {
  const iterations: Iteration[] = [];
  let pending: Run[] = [];
  let current: Run | undefined;
  let state: Timeline["state"] = "idle";
  let passes = 0, fails = 0;

  for (const e of events) {
    const ts = s(e.ts) ?? "";
    switch (e.type) {
      case "verify_start":
        current = { kind: "verify", start: ts, label: s(e.name) ?? s(e.objective) ?? "verify_with_kane", status: "running", steps: [] };
        pending.push(current);
        state = "verifying";
        break;
      case "replay_start": {
        const paths = Array.isArray(e.paths) ? (e.paths as unknown[]).filter((p) => typeof p === "string").join(", ") : "";
        current = { kind: "replay", start: ts, label: paths ? `replay ${paths}` : "replay saved flows", status: "running", steps: [] };
        pending.push(current);
        state = "verifying";
        break;
      }
      case "kane_event": {
        const k = (e.event ?? {}) as Json;
        if (current && typeof k.step === "number" && typeof k.status === "string") {
          const existing = current.steps.find((x) => x.step === k.step);
          const step: Step = { step: k.step, status: k.status, remark: s(k.remark) };
          if (existing) Object.assign(existing, step); else current.steps.push(step);
        }
        break;
      }
      case "verify_end":
      case "replay_end": {
        const run = current ?? [...pending].reverse().find((r) => r.status === "running");
        if (run) {
          run.end = ts;
          run.status = s(e.status) ?? "error";
          if (typeof e.failed_step === "number") run.failed_step = e.failed_step;
          run.remark = s(e.remark);
          run.test_url = s(e.test_url);
          if (Array.isArray(e.failed)) run.failed = e.failed as Run["failed"];
          if (run.status === "pass") passes++; else fails++;
        }
        current = undefined;
        if (!pending.some((r) => r.status === "running")) state = run?.status === "pass" ? "green" : "red";
        break;
      }
      case "loop_iteration": {
        const result = s(e.result) ?? "unknown";
        iterations.push({
          ts, result,
          iteration: typeof e.iteration === "number" ? e.iteration : 0,
          source: s(e.source), mode: s(e.mode), reason: s(e.reason),
          failed: Array.isArray(e.failed) ? (e.failed as Iteration["failed"]) : [],
          runs: pending,
        });
        pending = [];
        current = undefined;
        if (result === "green" || result === "red" || result === "gave_up") state = result;
        break;
      }
    }
  }
  if (pending.some((r) => r.status === "running")) state = "verifying";
  return { iterations, pending, state, passes, fails };
}

/** Parse JSONL text, skipping blank or torn lines. */
export function parseJsonl(text: string): Json[] {
  const out: Json[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as Json); } catch { /* torn line */ }
  }
  return out;
}

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

/** URL the console can load a failure screenshot from, or undefined if the path isn't a safe image. */
export function screenshotUrl(path: unknown, replay: boolean): string | undefined {
  if (typeof path !== "string" || !IMAGE.test(path) || path.includes("\0")) return undefined;
  if (replay) return /^https?:\/\//.test(path) || (!path.startsWith("/") && !path.includes("..")) ? path : undefined;
  return `/artifact?path=${encodeURIComponent(path)}`;
}
