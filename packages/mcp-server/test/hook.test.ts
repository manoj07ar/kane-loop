import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runStopHook } from "../src/hook.js";
import { computeStatus, readEvents } from "../src/loop.js";

const bin = resolve(__dirname, "fake-kane.mjs");
let dir: string;
const config = (extra: Record<string, unknown> = {}) =>
  writeFile(join(dir, ".kane-loop.json"), JSON.stringify({ flows: [{ url: "http://localhost:5173", objective: "split 100 three ways and verify total 100.00" }], ...extra }));

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "klh-")); });

describe("runStopHook", () => {
  it("skips with no flows configured", async () => {
    const r = await runStopHook("claude", {}, dir, { bin });
    expect(r.result).toBe("skipped");
    expect(r.output).toBeUndefined();
  });

  it("allows stop when Kane is green", async () => {
    await config();
    process.env.FAKE_KANE_SCENARIO = "pass";
    const r = await runStopHook("claude", {}, dir, { bin });
    expect(r.result).toBe("green");
    expect(r.output).toBeUndefined();
    expect(computeStatus(await readEvents(dir)).state).toBe("green");
  });

  it("blocks Claude Code with Kane's remark on red", async () => {
    await config();
    process.env.FAKE_KANE_SCENARIO = "fail";
    const r = await runStopHook("claude", {}, dir, { bin });
    expect(r.result).toBe("red");
    expect(r.output?.decision).toBe("block");
    expect(String(r.output?.reason)).toContain("step 2 failed: Total shows 99.99, expected 100.00");
    expect(String(r.output?.reason)).toContain("Don't weaken");
  });

  it("re-prompts Cursor via followup_message and skips aborted turns", async () => {
    await config();
    process.env.FAKE_KANE_SCENARIO = "fail";
    const r = await runStopHook("cursor", { status: "completed" }, dir, { bin });
    expect(String(r.output?.followup_message)).toContain("attempt 1 of 3");
    const aborted = await runStopHook("cursor", { status: "aborted" }, dir, { bin });
    expect(aborted.result).toBe("skipped");
  });

  it("counts red iterations, resets on green, and gives up after the cap", async () => {
    await config({ maxIterations: 2 });
    process.env.FAKE_KANE_SCENARIO = "fail";
    expect((await runStopHook("claude", {}, dir, { bin })).iteration).toBe(1);
    expect((await runStopHook("claude", {}, dir, { bin })).iteration).toBe(2);
    const third = await runStopHook("claude", {}, dir, { bin });
    expect(third.result).toBe("gave_up");
    expect(third.output).toBeUndefined();
    process.env.FAKE_KANE_SCENARIO = "pass";
    expect((await runStopHook("claude", {}, dir, { bin })).result).toBe("green");
    process.env.FAKE_KANE_SCENARIO = "fail";
    expect((await runStopHook("claude", {}, dir, { bin })).iteration).toBe(1);
    const s = computeStatus(await readEvents(dir));
    expect(s.state).toBe("red");
    expect(s.iteration).toBe(1);
  });

  it("doesn't loop the agent when Kane can't start", async () => {
    await config();
    process.env.FAKE_KANE_SCENARIO = "exit2";
    const r = await runStopHook("claude", {}, dir, { bin });
    expect(r.result).toBe("gave_up");
    expect(r.message).toContain("kane-cli login");
  });
});

describe("computeStatus", () => {
  it("is idle with no events", () => {
    expect(computeStatus([])).toMatchObject({ state: "idle", iteration: 0, total_runs: 0 });
  });
  it("shows verifying while a run is open", () => {
    expect(computeStatus([{ type: "verify_start" }]).state).toBe("verifying");
  });
});
