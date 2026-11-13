#!/usr/bin/env node
// Fake kane-cli for tests. Scenario chosen by FAKE_KANE_SCENARIO: pass | fail | exit2 | timeout
const scenario = process.env.FAKE_KANE_SCENARIO ?? "pass";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const base = { test_url: "https://test-manager.example/run/123", session_dir: "/tmp/fake-session" };
if (process.argv[2] === "--version") { process.stdout.write("0.10.3\n"); process.exit(0); }
if (process.argv[2] === "balance") {
  if (scenario === "noauth") { process.stdout.write('Not authenticated [prod]. Run "kane-cli login" first.\n'); process.exit(0); }
  process.stdout.write(scenario === "broke" ? "Balance: 0 credits\n" : "Balance: 9,840 credits\n"); process.exit(0);
}
out({ type: "argv", argv: process.argv.slice(2) });
if (process.argv[2] === "testrun") {
  const log = process.env.FAKE_KANE_LOG ?? "/tmp/fake-member.ndjson";
  if (scenario === "exit2") { process.stderr.write("Not logged in\n"); process.exit(2); }
  out({ type: "testrun_start", execution_id: "exec-1", members: ["flows/add_expense_test.md", "flows/settle_test.md"], parallel: 1 });
  out({ type: "testrun_member_event", event: { step: 1 } });
  out({ type: "testrun_member_end", path: "flows/add_expense_test.md", test_id: "T-1", status: "passed", duration_s: 4.2, log_path: "/tmp/a.ndjson" });
  const failing = scenario === "fail";
  out({ type: "testrun_member_end", path: "flows/settle_test.md", test_id: "T-2", status: failing ? "failed" : "passed", duration_s: 5.1, log_path: log,
    ...(failing ? { failure: { message: "Total shows 99.99, expected 100.00", step_index: 4 } } : {}) });
  out({ type: "testrun_summary", execution: {}, authored: [], totals: { passed: failing ? 1 : 2, failed: failing ? 1 : 0, broken: 0, skipped: 0 }, duration_s: 9.3, upload: null, cancelled: false });
  out({ type: "testrun_done", execution_id: "exec-1", overall_status: failing ? "failed" : "passed" });
  process.exit(failing ? 1 : 0);
}
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
