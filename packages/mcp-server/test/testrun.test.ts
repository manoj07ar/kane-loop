import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { replayTests, buildReplayArgs, getFailure } from "../src/testrun.js";

const bin = resolve(__dirname, "fake-kane.mjs");
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "kl-tr-")); });
const run = (scenario: string) => { process.env.FAKE_KANE_SCENARIO = scenario; return replayTests({}, { bin, eventsDir: dir }); };

describe("replayTests", () => {
  it("builds testrun args", () => {
    expect(buildReplayArgs({ paths: ["flows"], match: "settle", tags: ["a", "b"], failFast: true }))
      .toEqual(["testrun", "run", "flows", "--agent", "--on-failure", "fail-fast", "--match", "settle", "--tags", "a,b"]);
  });

  it("passes when every member passes", async () => {
    const r = await run("pass");
    expect(r.status).toBe("pass");
    expect(r.members).toHaveLength(2);
    expect(r.failed).toHaveLength(0);
    expect(r.execution_id).toBe("exec-1");
    expect(r.totals?.passed).toBe(2);
  });

  it("reports the failing member with its failure message", async () => {
    const r = await run("fail");
    expect(r.status).toBe("fail");
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.path).toBe("flows/settle_test.md");
    expect(r.failed[0]!.failure).toEqual({ message: "Total shows 99.99, expected 100.00", step_index: 4 });
    expect(r.summary).toContain("99.99");
    const log = await readFile(join(dir, ".kane-loop", "events.jsonl"), "utf8");
    expect(log).toContain("replay_end");
    expect(log).not.toContain("testrun_member_event");
  });

  it("reports not_started when kane can't start", async () => {
    const r = await run("exit2");
    expect(r.status).toBe("not_started");
    expect(r.summary).toContain("Not logged in");
  });
});

describe("getFailure", () => {
  it("extracts failing step, heading, remarks and screenshots", async () => {
    const p = join(dir, "events.ndjson");
    const lines = [
      { type: "test_md_step_start", step_index: 3, heading: "Add expense" },
      { type: "test_md_step_end", step_index: 3, status: "passed", remark: "Added" },
      { type: "test_md_step_start", step_index: 4, heading: "Verify total is 100.00" },
      { type: "test_md_step_end", step_index: 4, status: "failed", remark: "Total shows 99.99", screenshot: "/tmp/s4.png" },
      { type: "run_end", status: "failed", reason: "assertion failed" },
    ];
    await writeFile(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");
    const f = await getFailure(p);
    expect(f.failed_step).toBe(4);
    expect(f.heading).toBe("Verify total is 100.00");
    expect(f.message).toBe("assertion failed");
    expect(f.remarks).toContain("Total shows 99.99");
    expect(f.screenshots).toEqual(["/tmp/s4.png"]);
  });
});
