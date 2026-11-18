import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyWithKane, buildArgs, exitCodeToStatus, ensureStartUrl } from "../src/kane.js";

const bin = resolve(__dirname, "fake-kane.mjs");
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "kl-")); });

const run = (scenario: string, extra: Record<string, unknown> = {}) => {
  process.env.FAKE_KANE_SCENARIO = scenario;
  return verifyWithKane({ url: "http://localhost:3000", objective: "check total", ...extra }, { bin, eventsDir: dir });
};

describe("verifyWithKane", () => {
  it("passes on exit 0", async () => {
    const r = await run("pass");
    expect(r.status).toBe("pass");
    expect(r.steps).toHaveLength(2);
    expect(r.test_url).toContain("test-manager");
    expect(r.evidence).toBe("/tmp/fake-session");
    expect(r.credits_consumed).toBe(3);
    expect(r.failed_step).toBeUndefined();
  });

  it("fails on exit 1 with failed step remark", async () => {
    const r = await run("fail");
    expect(r.status).toBe("fail");
    expect(r.failed_step).toBe(2);
    expect(r.remark).toContain("99.99");
    expect(r.summary).toBe("Step 2 failed");
  });

  it("reports not_started on exit 2", async () => {
    const r = await run("exit2");
    expect(r.status).toBe("not_started");
    expect(r.exit_code).toBe(2);
    expect(r.reason).toBe("not logged in");
  });

  it("reports timeout on exit 3", async () => {
    const r = await run("timeout");
    expect(r.status).toBe("timeout");
    expect(r.exit_code).toBe(3);
  });

  it("reports error when the binary is missing", async () => {
    const r = await verifyWithKane({ url: "http://x.test", objective: "o" }, { bin: join(dir, "nope"), eventsDir: dir });
    expect(r.status).toBe("error");
  });

  it("appends events to .kane-loop/events.jsonl", async () => {
    await run("fail");
    const lines = (await readFile(join(dir, ".kane-loop", "events.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].type).toBe("verify_start");
    expect(lines.at(-1).type).toBe("verify_end");
    expect(lines.at(-1).status).toBe("fail");
    expect(lines.some((l) => l.type === "kane_event")).toBe(true);
  });

  it("passes the right CLI args, slugifying name", async () => {
    await run("pass", { name: "Split Bill!", timeout: 60 });
    const lines = (await readFile(join(dir, ".kane-loop", "events.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const argv = lines.find((l) => l.event?.type === "argv").event.argv;
    expect(argv).toEqual(["run", "check total", "--url", "http://localhost:3000", "--agent", "--headless", "--timeout", "60", "--name", "split-bill"]);
  });
});

describe("helpers", () => {
  it("maps exit codes", () => {
    expect([0, 1, 2, 3, 7, null].map(exitCodeToStatus)).toEqual(["pass", "fail", "not_started", "timeout", "error", "error"]);
  });
  it("defaults timeout to 180 and omits name", () => {
    expect(buildArgs({ url: "u", objective: "o" })).toEqual(["run", "o", "--url", "u", "--agent", "--headless", "--timeout", "180"]);
  });
});

// Frontmatter exactly as kane-cli 0.10.3 wrote it for `run --name splitly-even-split` on 18 Nov 2026.
const REAL_SAVED_MD = "---\nmode: testing\nmax_steps: 50\ntimeout: 240\ntarget: chrome\nheadless: true\n---\n\n# Session: splitly-even-split\n\n## Step 1\nClick Reset.\n";

describe("real kane-cli 0.10.3 run stream", () => {
  it("parses a recorded green run and pins the start URL into the saved flow", async () => {
    const tp = join(dir, "splitly-even-split_test.md");
    process.env.FAKE_KANE_FILE = resolve(__dirname, "fixtures", "real-run-pass-splitly-even-split.ndjson");
    process.env.FAKE_KANE_TEST_PATH = tp;
    process.env.FAKE_KANE_TEST_MD = REAL_SAVED_MD;
    const r = await run("file", { url: "http://127.0.0.1:5173", name: "splitly-even-split" });
    delete process.env.FAKE_KANE_TEST_MD;
    expect(r.status).toBe("pass");
    expect(r.one_liner).toBe("settled a Taxi expense on the expense-splitting page");
    expect(r.reason).toBe("Objective completed");
    expect(r.credits_consumed).toBeCloseTo(33.05, 1);
    expect(r.session_dir).toBe("/tmp/kane-session");
    expect(r.saved_test).toBe(tp);
    expect(r.steps.filter((s) => s.status === "done").length).toBeGreaterThan(10);
    expect(r.failed_step).toBeUndefined();
    const md = await readFile(tp, "utf8");
    expect(md.startsWith('---\nurl: "http://127.0.0.1:5173"\nmode: testing\n')).toBe(true);
    expect(await readFile(join(dir, ".kane-loop", "events.jsonl"), "utf8")).toContain("saved_flow_url_pinned");
  });
});

describe("ensureStartUrl", () => {
  it("adds url to frontmatter once, or creates frontmatter", async () => {
    const a = join(dir, "a_test.md");
    await writeFile(a, REAL_SAVED_MD);
    expect(await ensureStartUrl(a, "http://x")).toBe(true);
    expect(await ensureStartUrl(a, "http://y")).toBe(false);
    expect((await readFile(a, "utf8")).match(/^url:/gm)).toHaveLength(1);
    const b = join(dir, "b_test.md");
    await writeFile(b, "## Step 1\nGo\n");
    expect(await ensureStartUrl(b, "http://x")).toBe(true);
    expect(await readFile(b, "utf8")).toBe('---\nurl: "http://x"\n---\n\n## Step 1\nGo\n');
    expect(await ensureStartUrl(join(dir, "missing_test.md"), "http://x")).toBe(false);
  });
});
