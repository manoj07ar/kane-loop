#!/usr/bin/env node
// Usage: kane-loop init [--url http://localhost:5173] [--max 3] [--dry-run] [--dir path]
import { resolve } from "node:path";
import { runInit } from "./init.js";

const args = process.argv.slice(2);
const cmd = args.shift();
if (cmd !== "init") {
  process.stderr.write("usage: kane-loop init [--url <app url>] [--max <iterations>] [--dry-run] [--dir <repo>]\n");
  process.exit(64);
}
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = resolve(flag("--dir") ?? process.cwd());
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
