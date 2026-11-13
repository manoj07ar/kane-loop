import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findSavedFlows, loadConfig } from "./loop.js";

export type CheckLevel = "ok" | "warn" | "fail";
export interface Check { name: string; level: CheckLevel; detail: string; fix?: string }
export interface DoctorOptions { bin?: string; checkUrl?: boolean; urlTimeoutMs?: number }

function run(bin: string, args: string[], timeoutMs = 20000): Promise<{ code: number | null; out: string; missing: boolean }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: unknown }) | null;
      const missing = e?.code === "ENOENT";
      const code = e ? (typeof e.code === "number" ? e.code : missing ? null : 1) : 0;
      resolve({ code, out: `${stdout ?? ""}${stderr ?? ""}`.trim(), missing });
    });
  });
}

function readJson(dir: string, file: string): unknown {
  try { return JSON.parse(readFileSync(join(dir, file), "utf8")); } catch { return undefined; }
}
const mentions = (v: unknown, needle: string) => v !== undefined && JSON.stringify(v).includes(needle);

/** Pre-flight checks so a demo or a fresh install fails loudly before the agent loop starts. */
export async function runDoctor(dir: string, opts: DoctorOptions = {}): Promise<Check[]> {
  const bin = opts.bin ?? process.env.KANE_CLI_BIN ?? "kane-cli";
  const checks: Check[] = [];

  const ver = await run(bin, ["--version"]);
  if (ver.missing) {
    checks.push({ name: "kane-cli", level: "fail", detail: `not found (${bin})`, fix: "Install Kane CLI, or set KANE_CLI_BIN to its path." });
  } else {
    checks.push({ name: "kane-cli", level: ver.code === 0 ? "ok" : "warn", detail: (ver.out.split("\n")[0] ?? "") || `exit ${ver.code}` });
    const bal = await run(bin, ["balance"]);
    if (/not authenticated|not logged in|login/i.test(bal.out) && !/credit/i.test(bal.out)) {
      checks.push({ name: "login", level: "fail", detail: "kane-cli is not logged in", fix: "Run: kane-cli login --oauth" });
    } else if (bal.code !== 0) {
      checks.push({ name: "login", level: "warn", detail: `kane-cli balance exited ${bal.code}: ${bal.out.slice(0, 200)}` });
    } else {
      const m = bal.out.match(/([\d,]+(?:\.\d+)?)\s*credits?/i) ?? bal.out.match(/credits?\D{0,20}([\d,]+(?:\.\d+)?)/i);
      const credits = m?.[1] ? Number(m[1].replace(/,/g, "")) : undefined;
      if (credits !== undefined && credits <= 0) checks.push({ name: "credits", level: "fail", detail: "0 credits left", fix: "Live runs need credits; saved-flow replays are free." });
      else checks.push({ name: "credits", level: "ok", detail: credits !== undefined ? `${credits} credits` : (bal.out.split("\n")[0] ?? "") });
    }
  }

  const rawCfg = readJson(dir, ".kane-loop.json");
  const cfg = await loadConfig(dir);
  const saved = await findSavedFlows(dir);
  if (rawCfg === undefined) checks.push({ name: "config", level: "fail", detail: ".kane-loop.json missing or invalid JSON", fix: "Run: kane-loop init --url <your app url>" });
  else if (cfg.flows.length === 0 && saved.length === 0) checks.push({ name: "config", level: "fail", detail: "no flows in .kane-loop.json and no saved flows", fix: 'Add a flow: { "url": ..., "objective": ... }' });
  else checks.push({ name: "config", level: "ok", detail: `${cfg.flows.length} live flow(s), ${saved.length} saved flow(s) (replays cost 0 credits), max ${cfg.maxIterations} iterations` });

  const cursorHook = mentions(readJson(dir, ".cursor/hooks.json"), "kane-loop-hook cursor");
  const claudeHook = mentions(readJson(dir, ".claude/settings.json"), "kane-loop-hook claude");
  checks.push(cursorHook || claudeHook
    ? { name: "hooks", level: "ok", detail: [cursorHook && "Cursor", claudeHook && "Claude Code"].filter(Boolean).join(" + ") }
    : { name: "hooks", level: "fail", detail: "no stop hook wired, so the agent can stop without Kane", fix: "Run: kane-loop init" });

  const mcp = mentions(readJson(dir, ".cursor/mcp.json"), "kane-loop-mcp") || mentions(readJson(dir, ".mcp.json"), "kane-loop-mcp");
  checks.push(mcp ? { name: "mcp", level: "ok", detail: "kane-loop MCP server configured" }
    : { name: "mcp", level: "warn", detail: "MCP server not configured (hooks still work)", fix: "Run: kane-loop init" });

  if (opts.checkUrl !== false) {
    for (const url of [...new Set(cfg.flows.map((f) => f.url))]) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(opts.urlTimeoutMs ?? 3000) });
        checks.push({ name: "app", level: res.ok ? "ok" : "warn", detail: `${url} answered ${res.status}` });
      } catch {
        checks.push({ name: "app", level: "warn", detail: `${url} is not reachable`, fix: "Start your app before the agent's turn ends." });
      }
    }
  }
  return checks;
}

export function formatChecks(checks: Check[]): string {
  const icon = { ok: "✔", warn: "!", fail: "✘" } as const;
  return checks.map((c) => `${icon[c.level]} ${c.name.padEnd(8)} ${c.detail}${c.fix ? `\n    → ${c.fix}` : ""}`).join("\n");
}
