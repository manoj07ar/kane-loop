import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveDir, runStopHook } from "../src/hook.js";
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

describe("resolveDir", () => {
  it("prefers KANE_LOOP_DIR, then Claude cwd, then Cursor workspace_roots, then env, then fallback", () => {
    expect(resolveDir({ cwd: "/a" }, { KANE_LOOP_DIR: "/o" }, "/f")).toBe("/o");
    expect(resolveDir({ cwd: "/a", workspace_roots: ["/w"] }, {}, "/f")).toBe("/a");
    expect(resolveDir({ workspace_roots: ["/w", "/x"] }, { CURSOR_PROJECT_DIR: "/c" }, "/f")).toBe("/w");
    expect(resolveDir({}, { CURSOR_PROJECT_DIR: "/c" }, "/f")).toBe("/c");
    expect(resolveDir({}, { CLAUDE_PROJECT_DIR: "/cl" }, "/f")).toBe("/cl");
    expect(resolveDir({}, {}, "/f")).toBe("/f");
  });
});

describe("cursor loop_count", () => {
  it("gives up when Cursor already auto-continued maxIterations times", async () => {
    await config({ maxIterations: 3 });
    process.env.FAKE_KANE_SCENARIO = "fail";
    const r = await runStopHook("cursor", { status: "completed", loop_count: 3 }, dir, { bin });
    expect(r.result).toBe("gave_up");
    expect(r.output).toBeUndefined();
  });
  it("numbers the attempt from Cursor's loop_count", async () => {
    await config({ maxIterations: 3 });
    process.env.FAKE_KANE_SCENARIO = "fail";
    const r = await runStopHook("cursor", { status: "completed", loop_count: 1 }, dir, { bin });
    expect(r.result).toBe("red");
    expect(r.iteration).toBe(2);
    expect(String(r.output?.followup_message)).toContain("attempt 2 of 3");
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

describe("replay mode (saved flows)", () => {
  const saveFlow = async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".testmuai", "tests"), { recursive: true });
    await writeFile(join(dir, ".testmuai", "tests", "settle_test.md"), "# Settle\n");
  };

  it("prefers replaying saved flows over live runs and passes the saved files to testrun (kane-cli rejects folders)", async () => {
    await config();
    await saveFlow();
    process.env.FAKE_KANE_SCENARIO = "pass";
    const r = await runStopHook("claude", {}, dir, { bin });
    expect(r.result).toBe("green");
    expect(r.mode).toBe("replay");
    const events = await readEvents(dir);
    const argv = events.find((e) => (e.event as { type?: string })?.type === "argv")?.event as { argv: string[] } | undefined;
    expect(argv?.argv.slice(0, 4)).toEqual(["testrun", "run", ".testmuai/tests/settle_test.md", "--agent"]);
  });

  it("works with saved flows and no live flows in config", async () => {
    await saveFlow();
    process.env.FAKE_KANE_SCENARIO = "pass";
    expect((await runStopHook("claude", {}, dir, { bin })).result).toBe("green");
  });

  it("blocks with the failing saved flow, step heading and Kane's remark from the member log", async () => {
    await saveFlow();
    const log = join(dir, "member.ndjson");
    await writeFile(log, [
      { type: "test_md_step_start", step_index: 4, heading: "Verify total is 100.00" },
      { type: "test_md_step_end", step_index: 4, status: "failed", remark: "Rounded each share down", screenshot: "/tmp/s4.png" },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n");
    process.env.FAKE_KANE_SCENARIO = "fail";
    process.env.FAKE_KANE_LOG = log;
    const r = await runStopHook("cursor", { status: "completed" }, dir, { bin });
    delete process.env.FAKE_KANE_LOG;
    expect(r.result).toBe("red");
    const msg = String(r.output?.followup_message);
    expect(msg).toContain('Saved flow flows/settle_test.md: step 4 ("Verify total is 100.00") failed: Total shows 99.99, expected 100.00');
    expect(msg).toContain("Rounded each share down");
    expect(msg).toContain("/tmp/s4.png");
    const evs = await readEvents(dir);
    const red = evs.find((e) => e.type === "loop_iteration" && e.result === "red") as { failed?: { screenshot?: string }[] } | undefined;
    expect(red?.failed?.[0]?.screenshot).toBe("/tmp/s4.png");
    expect(computeStatus(evs).state).toBe("red");
  });

  it("doesn't loop when the replay can't start", async () => {
    await saveFlow();
    process.env.FAKE_KANE_SCENARIO = "exit2";
    const r = await runStopHook("claude", {}, dir, { bin });
    expect(r.result).toBe("gave_up");
    expect(r.output).toBeUndefined();
    expect(r.message).toContain("Not logged in");
  });

  it("honours replay: false and an explicit replay config", async () => {
    await saveFlow();
    await config({ replay: false });
    process.env.FAKE_KANE_SCENARIO = "pass";
    expect((await runStopHook("claude", {}, dir, { bin })).mode).toBe("live");
    await config({ replay: { paths: ["flows"], match: "settle" } });
    const r = await runStopHook("claude", {}, dir, { bin });
    expect(r.mode).toBe("replay");
    const argvs = (await readEvents(dir)).map((e) => (e.event as { type?: string; argv?: string[] })).filter((e) => e?.type === "argv");
    expect(argvs.at(-1)?.argv).toEqual(["testrun", "run", "flows", "--agent", "--on-failure", "continue", "--match", "settle"]);
  });
});
