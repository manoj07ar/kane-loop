// `kane-loop init`: wires Kane Loop into a repo for Cursor and Claude Code.
// Idempotent: merges into existing JSON configs, never duplicates entries,
// never overwrites a user's .kane-loop.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface InitOptions { url?: string; maxIterations?: number; dryRun?: boolean }
export interface InitChange { file: string; action: "created" | "updated" | "unchanged" }

const MCP_ENTRY = { command: "kane-loop-mcp", args: [] as string[] };
const AGENTS_MARKER = "<!-- kane-loop -->";
const AGENTS_BLOCK = `${AGENTS_MARKER}
## Kane Loop
- After changing UI or behaviour, call the \`verify_with_kane\` MCP tool with the app URL and a plain-English objective. Give new flows a \`name\` so they are saved and replayed for free.
- You are not done until Kane is green. If the stop hook reports a failing step, fix the app. Never weaken, delete or skip the Kane test to get green.
- Use \`get_failure\` to read the failing step, Kane's remark and screenshots before editing.
`;
const GITIGNORE_LINES = [".kane-loop/", ".testmuai/evidence/", ".testmuai/variables/"];

function readJson(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error(`${path} is not valid JSON; fix or remove it and re-run init`); }
}

function hasCommand(list: unknown, cmd: string): boolean {
  return Array.isArray(list) && JSON.stringify(list).includes(JSON.stringify(cmd));
}

export function planInit(dir: string, opts: InitOptions = {}): Map<string, string> {
  const max = opts.maxIterations ?? 3;
  const out = new Map<string, string>();
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

  // Cursor MCP + Claude Code project MCP
  for (const rel of [".cursor/mcp.json", ".mcp.json"]) {
    const cfg = readJson(join(dir, rel));
    cfg.mcpServers = { ...(cfg.mcpServers ?? {}) };
    if (!cfg.mcpServers["kane-loop"]) cfg.mcpServers["kane-loop"] = MCP_ENTRY;
    out.set(rel, json(cfg));
  }

  // Cursor stop hook
  {
    const cmd = "kane-loop-hook cursor";
    const cfg = readJson(join(dir, ".cursor/hooks.json"));
    cfg.version ??= 1;
    cfg.hooks = { ...(cfg.hooks ?? {}) };
    const stop = Array.isArray(cfg.hooks.stop) ? [...cfg.hooks.stop] : [];
    if (!hasCommand(stop, cmd)) stop.push({ command: cmd, timeout: 600, loop_limit: max });
    cfg.hooks.stop = stop;
    out.set(".cursor/hooks.json", json(cfg));
  }

  // Claude Code Stop hook
  {
    const cmd = "kane-loop-hook claude";
    const cfg = readJson(join(dir, ".claude/settings.json"));
    cfg.hooks = { ...(cfg.hooks ?? {}) };
    const stop = Array.isArray(cfg.hooks.Stop) ? [...cfg.hooks.Stop] : [];
    if (!hasCommand(stop, cmd)) stop.push({ hooks: [{ type: "command", command: cmd, timeout: 600 }] });
    cfg.hooks.Stop = stop;
    out.set(".claude/settings.json", json(cfg));
  }

  // Loop config: only created, never rewritten
  if (!existsSync(join(dir, ".kane-loop.json"))) {
    const url = opts.url ?? "http://localhost:5173";
    out.set(".kane-loop.json", json({
      flows: [{ url, objective: "Open the app and verify the main page loads without errors" }],
      maxIterations: max,
    }));
  }

  // AGENTS.md guidance
  {
    const p = join(dir, "AGENTS.md");
    const cur = existsSync(p) ? readFileSync(p, "utf8") : "";
    out.set("AGENTS.md", cur.includes(AGENTS_MARKER) ? cur : (cur ? cur.replace(/\n*$/, "\n\n") : "") + AGENTS_BLOCK);
  }

  // .gitignore
  {
    const p = join(dir, ".gitignore");
    const cur = existsSync(p) ? readFileSync(p, "utf8") : "";
    const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
    const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
    out.set(".gitignore", missing.length ? (cur ? cur.replace(/\n*$/, "\n") : "") + missing.join("\n") + "\n" : cur);
  }
  return out;
}

export function runInit(dir: string, opts: InitOptions = {}): InitChange[] {
  const changes: InitChange[] = [];
  for (const [rel, content] of planInit(dir, opts)) {
    const p = join(dir, rel);
    const before = existsSync(p) ? readFileSync(p, "utf8") : null;
    const action = before === null ? "created" : before === content ? "unchanged" : "updated";
    if (action !== "unchanged" && !opts.dryRun) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    changes.push({ file: rel, action });
  }
  return changes;
}
