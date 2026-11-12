#!/usr/bin/env node
// Fake kane-cli for tests. Scenario chosen by FAKE_KANE_SCENARIO: pass | fail | exit2 | timeout
const scenario = process.env.FAKE_KANE_SCENARIO ?? "pass";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const base = { test_url: "https://test-manager.example/run/123", session_dir: "/tmp/fake-session" };
out({ type: "argv", argv: process.argv.slice(2) });
if (scenario === "exit2") {
  process.stderr.write("Not logged in\n");
  out({ type: "run_end", status: "not_started", reason: "not logged in" });
  process.exit(2);
}
out({ type: "stream_start", version: "0.10.3" });
out({ step: 1, status: "passed", remark: "Opened page" });
if (scenario === "pass") {
  out({ step: 2, status: "passed", remark: "Total shows 100.00" });
  out({ type: "run_end", status: "passed", summary: "All steps passed", one_liner: "Green", reason: "", duration: 12.5, credits_consumed: 3, final_state: "done", ...base });
  process.exit(0);
}
if (scenario === "fail") {
  out({ step: 2, status: "failed", remark: "Total shows 99.99, expected 100.00" });
  out({ type: "run_end", status: "failed", summary: "Step 2 failed", one_liner: "Rounding bug", reason: "assertion", duration: 9, credits_consumed: 2, final_state: "failed", ...base });
  process.exit(1);
}
if (scenario === "timeout") {
  out({ step: 2, status: "running", remark: "Waiting for spinner" });
  out({ type: "run_end", status: "timeout", summary: "Timed out", one_liner: "Timeout", reason: "timeout", duration: 180, credits_consumed: 5, final_state: "timeout", ...base });
  process.exit(3);
}
process.exit(9);
