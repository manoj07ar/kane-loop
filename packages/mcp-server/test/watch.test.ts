import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDebouncer, runWatchCheck, shouldIgnore, startWatch, LAST_FAILURE_FILE, type WatchRun } from "../src/watch.js";
import { computeStatus, readEvents } from "../src/loop.js";

const bin = resolve(__dirname, "fake-kane.mjs");
let dir: string;
const config = () => writeFile(join(dir, ".kane-loop.json"), JSON.stringify({ flows: [{ url: "http://localhost:5173", objective: "split 100 three ways and verify total 100.00" }] }));
const exists = (p: string) => access(p).then(() => true, () => false);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "klw-")); });

describe("shouldIgnore", () => {
  it("ignores build output, deps, Kane artefacts and editor temp files", () => {
    for (const p of ["node_modules/x/index.js", ".git/HEAD", ".kane-loop/events.jsonl", ".testmuai/tests/a_test.md", "apps/demo/dist/main.js", "output-split/run.json", "src/.#main.ts", "src/main.ts~", "src/.main.ts.swp", "npm-debug.log", ""]) {
      expect(shouldIgnore(p), p).toBe(true);
    }
  });
  it("watches source files", () => {
    for (const p of ["src/split.ts", "apps/demo/index.html", "styles.css", "outputs.ts"]) expect(shouldIgnore(p), p).toBe(false);
  });
});

describe("createDebouncer", () => {
  it("collapses a burst into one run and queues one re-run while busy", async () => {
    let calls = 0;
    const d = createDebouncer(async () => { calls++; await sleep(60); }, 20);
    d.schedule(); d.schedule(); d.schedule();
    await sleep(40);
    expect(calls).toBe(1);
    d.schedule(); d.schedule(); // while running
    await sleep(160);
    expect(calls).toBe(2);
  });
});

describe("runWatchCheck", () => {
  it("skips without flows", async () => {
    expect((await runWatchCheck(dir, ["src/a.ts"], { bin })).result).toBe("skipped");
  });

  it("writes last-failure.md on red, clears it on green, and never touches the stop-hook iteration count", async () => {
    await config();
    process.env.FAKE_KANE_SCENARIO = "fail";
    const red = await runWatchCheck(dir, ["src/split.ts"], { bin });
    expect(red.result).toBe("red");
    expect(red.message).toContain("after you saved");
    expect(red.message).not.toContain("attempt");
    const md = await readFile(join(dir, LAST_FAILURE_FILE), "utf8");
    expect(md).toContain("Total shows 99.99, expected 100.00");
    expect(md).toContain("src/split.ts");
    const events = await readEvents(dir);
    expect(events.some((e) => e.type === "watch_run" && e.result === "red")).toBe(true);
    expect(computeStatus(events).iteration).toBe(0);

    process.env.FAKE_KANE_SCENARIO = "pass";
    expect((await runWatchCheck(dir, ["src/split.ts"], { bin })).result).toBe("green");
    expect(await exists(join(dir, LAST_FAILURE_FILE))).toBe(false);
  });

  it("reports Kane being unavailable instead of red", async () => {
    await config();
    process.env.FAKE_KANE_SCENARIO = "exit2";
    const r = await runWatchCheck(dir, [], { bin });
    expect(r.result).toBe("unavailable");
    expect(await exists(join(dir, LAST_FAILURE_FILE))).toBe(false);
  });
});

describe("startWatch", () => {
  it("runs Kane once after a burst of real saves and ignores node_modules", async () => {
    await config();
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "node_modules"));
    process.env.FAKE_KANE_SCENARIO = "pass";
    const runs: WatchRun[] = [];
    const w = startWatch(dir, { bin, debounceMs: 150, onRun: (r) => runs.push(r) });
    try {
      await sleep(100);
      await writeFile(join(dir, "node_modules", "junk.js"), "x");
      await sleep(400);
      expect(runs.length).toBe(0);
      await writeFile(join(dir, "src", "a.ts"), "1");
      await writeFile(join(dir, "src", "b.ts"), "2");
      for (let i = 0; i < 40 && runs.length === 0; i++) await sleep(100);
      expect(runs.length).toBe(1);
      expect(runs[0]!.result).toBe("green");
      expect(runs[0]!.changed).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]));
    } finally { w.close(); }
  });
});
