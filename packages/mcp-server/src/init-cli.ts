#!/usr/bin/env node
// Usage: kane-loop init [--url http://localhost:5173] [--max 3] [--dry-run] [--dir path]
//        kane-loop doctor [--dir path] [--no-url]
//        kane-loop watch [--dir path] [--debounce 1500]
import { resolve } from "node:path";
import { runInit } from "./init.js";
import { formatChecks, runDoctor } from "./doctor.js";
import { LAST_FAILURE_FILE, startWatch } from "./watch.js";

const args = process.argv.slice(2);
const cmd = args.shift();
if (cmd !== "init" && cmd !== "doctor" && cmd !== "watch") {
  process.stderr.write("usage: kane-loop init [--url <app url>] [--max <iterations>] [--dry-run] [--dir <repo>]\n       kane-loop doctor [--dir <repo>] [--no-url]\n       kane-loop watch [--dir <repo>] [--debounce <ms>]\n");
  process.exit(64);
}
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = resolve(flag("--dir") ?? process.cwd());
if (cmd === "watch") {
  const debounceMs = flag("--debounce") ? Number(flag("--debounce")) : 1500;
  if (!Number.isFinite(debounceMs) || debounceMs < 100) { process.stderr.write("--debounce must be at least 100 (ms)\n"); process.exit(64); }
  const stamp = () => new Date().toLocaleTimeString();
  process.stdout.write(`kane-loop watch: re-running Kane ${debounceMs} ms after saves settle in ${dir}. Ctrl+C to stop.\n`);
  const w = startWatch(dir, {
    debounceMs,
    onRun: (r) => {
      const files = r.changed.length ? ` (${r.changed.slice(0, 3).join(", ")}${r.changed.length > 3 ? ", ..." : ""})` : "";
      if (r.result === "green") process.stdout.write(`[${stamp()}] green: ${r.ran} ${r.mode} flow(s) passed${files}\n`);
      else if (r.result === "red") process.stdout.write(`[${stamp()}] RED${files}\n${r.message}\nWritten to ${LAST_FAILURE_FILE}\n`);
      else process.stdout.write(`[${stamp()}] ${r.result}: ${r.message ?? ""}\n`);
    },
    onError: (e) => process.stderr.write(`[${stamp()}] watch error: ${e.message}\n`),
  });
  process.on("SIGINT", () => { w.close(); process.exit(0); });
  await new Promise(() => {});
}
if (cmd === "doctor") {
  const checks = await runDoctor(dir, { checkUrl: !args.includes("--no-url") });
  process.stdout.write(formatChecks(checks) + "\n");
  const failed = checks.filter((c) => c.level === "fail").length;
  process.stdout.write(failed ? `\n${failed} problem(s) to fix before the loop can run.\n` : "\nReady: the agent can't stop until Kane is green.\n");
  process.exit(failed ? 1 : 0);
}
const max = flag("--max") ? Number(flag("--max")) : undefined;
if (max !== undefined && (!Number.isInteger(max) || max < 1)) { process.stderr.write("--max must be a positive integer\n"); process.exit(64); }
try {
  const changes = runInit(dir, { url: flag("--url"), maxIterations: max, dryRun: args.includes("--dry-run") });
  for (const c of changes) process.stdout.write(`${c.action.padEnd(9)} ${c.file}\n`);
  process.stdout.write("\nNext: kane-cli login --oauth, start your app, then ask your agent to build something. It can't stop until Kane is green.\n");
} catch (e) {
  process.stderr.write(`kane-loop init failed: ${(e as Error).message}\n`);
  process.exit(1);
}
