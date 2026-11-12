import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyWithKane, buildArgs, exitCodeToStatus } from "../src/kane.js";

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
