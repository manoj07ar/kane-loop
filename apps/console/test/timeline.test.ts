/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import sample from "../public/sample-loop.jsonl?raw";
import { buildTimeline, parseJsonl, screenshotUrl } from "../src/timeline";

describe("buildTimeline", () => {
  it("groups runs under the loop iteration they led to (red then green)", () => {
    const t = buildTimeline(parseJsonl(sample));
    expect(t.iterations.map((i) => i.result)).toEqual(["red", "green"]);
    expect(t.iterations[0].runs).toHaveLength(1);
    expect(t.iterations[0].runs[0].status).toBe("fail");
    expect(t.iterations[0].runs[0].steps.map((s) => s.status)).toEqual(["passed", "passed", "passed", "failed"]);
    expect(t.iterations[0].failed[0].failed_step).toBe(4);
    expect(t.state).toBe("green");
    expect([t.passes, t.fails]).toEqual([1, 1]);
    expect(t.pending).toEqual([]);
  });

  it("keeps an open live verify as pending and verifying", () => {
    const t = buildTimeline([
      { ts: "2026-11-12T18:00:00Z", type: "verify_start", objective: "add expense" },
      { ts: "2026-11-12T18:00:01Z", type: "kane_event", event: { step: 1, status: "running" } },
      { ts: "2026-11-12T18:00:02Z", type: "kane_event", event: { step: 1, status: "passed" } },
    ]);
    expect(t.state).toBe("verifying");
    expect(t.pending[0].label).toBe("add expense");
    expect(t.pending[0].steps).toEqual([{ step: 1, status: "passed", remark: undefined }]);
  });

  it("marks a standalone failed verify red with remark and test url", () => {
    const t = buildTimeline([
      { ts: "a", type: "verify_start", name: "split" },
      { ts: "b", type: "verify_end", status: "fail", failed_step: 2, remark: "button hidden", test_url: "https://example.test/run/1" },
    ]);
    expect(t.state).toBe("red");
    expect(t.pending[0]).toMatchObject({ status: "fail", failed_step: 2, remark: "button hidden" });
  });

  it("records gave_up with reason and skips torn lines", () => {
    const evs = parseJsonl('{"type":"loop_iteration","result":"gave_up","iteration":3,"reason":"max_iterations"}\n{"type":"loop_it');
    const t = buildTimeline(evs);
    expect(t.state).toBe("gave_up");
    expect(t.iterations[0].reason).toBe("max_iterations");
  });
});

describe("screenshotUrl", () => {
  it("routes live screenshots through /artifact and keeps the failure screenshot on the iteration", () => {
    const t = buildTimeline([{ ts: "a", type: "loop_iteration", result: "red", iteration: 1, failed: [{ path: "x_test.md", screenshot: ".testmuai/evidence/s 4.png" }] }]);
    expect(screenshotUrl(t.iterations[0].failed[0].screenshot, false)).toBe("/artifact?path=.testmuai%2Fevidence%2Fs%204.png");
  });
  it("rejects non-images and unsafe replay paths", () => {
    expect(screenshotUrl("/etc/passwd", false)).toBeUndefined();
    expect(screenshotUrl(42, false)).toBeUndefined();
    expect(screenshotUrl("../secret.png", true)).toBeUndefined();
    expect(screenshotUrl("/abs/shot.png", true)).toBeUndefined();
    expect(screenshotUrl("shots/fail.png", true)).toBe("shots/fail.png");
    expect(screenshotUrl("https://example.test/s.png", true)).toBe("https://example.test/s.png");
  });
});
