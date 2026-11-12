#!/usr/bin/env node
// Usage (in hook config): kane-loop-hook claude | kane-loop-hook cursor
import { runStopHook, type AgentKind } from "./hook.js";

const agent = (process.argv[2] ?? "claude") as AgentKind;
if (agent !== "claude" && agent !== "cursor") {
  process.stderr.write("usage: kane-loop-hook <claude|cursor>\n");
  process.exit(64);
}
let raw = "";
process.stdin.setEncoding("utf8");
for await (const c of process.stdin) raw += c;
let input: Record<string, unknown> = {};
try { input = raw.trim() ? JSON.parse(raw) : {}; } catch { /* tolerate empty/invalid stdin */ }
const dir = process.env.KANE_LOOP_DIR ?? (typeof input.cwd === "string" ? input.cwd : process.cwd());
const out = await runStopHook(agent, input, dir);
if (out.output) process.stdout.write(JSON.stringify(out.output) + "\n");
else if (out.message) process.stderr.write(`kane-loop: ${out.result}: ${out.message}\n`);
process.exit(0);
