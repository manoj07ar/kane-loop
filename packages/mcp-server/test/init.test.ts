import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../src/init.js";

const tmp = () => mkdtempSync(join(tmpdir(), "kl-init-"));
const j = (d: string, f: string) => JSON.parse(readFileSync(join(d, f), "utf8"));

describe("kane-loop init", () => {
  it("creates all config in an empty repo", () => {
    const d = tmp();
    const ch = runInit(d, { url: "http://localhost:3000", maxIterations: 2 });
    expect(ch.every((c) => c.action === "created")).toBe(true);
    expect(j(d, ".cursor/mcp.json").mcpServers["kane-loop"].command).toBe("kane-loop-mcp");
    expect(j(d, ".mcp.json").mcpServers["kane-loop"].command).toBe("kane-loop-mcp");
    expect(j(d, ".cursor/hooks.json").hooks.stop[0]).toMatchObject({ command: "kane-loop-hook cursor", loop_limit: 2 });
    expect(j(d, ".claude/settings.json").hooks.Stop[0].hooks[0].command).toBe("kane-loop-hook claude");
    expect(j(d, ".kane-loop.json")).toMatchObject({ maxIterations: 2, flows: [{ url: "http://localhost:3000" }] });
    expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toContain("verify_with_kane");
    expect(readFileSync(join(d, ".gitignore"), "utf8")).toContain(".kane-loop/");
  });

  it("is idempotent", () => {
    const d = tmp();
    runInit(d);
    const second = runInit(d);
    expect(second.every((c) => c.action === "unchanged")).toBe(true);
    expect(j(d, ".cursor/hooks.json").hooks.stop).toHaveLength(1);
  });

  it("merges with existing configs and keeps user content", () => {
    const d = tmp();
    mkdirSync(join(d, ".cursor"));
    writeFileSync(join(d, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    writeFileSync(join(d, ".cursor/hooks.json"), JSON.stringify({ version: 1, hooks: { stop: [{ command: "lint" }], afterFileEdit: [{ command: "fmt" }] } }));
    writeFileSync(join(d, ".kane-loop.json"), '{"flows":[],"maxIterations":5}\n');
    writeFileSync(join(d, "AGENTS.md"), "# Rules\nBe nice.");
    writeFileSync(join(d, ".gitignore"), "node_modules\n.kane-loop/\n");
    runInit(d);
    expect(Object.keys(j(d, ".cursor/mcp.json").mcpServers).sort()).toEqual(["kane-loop", "other"]);
    const hooks = j(d, ".cursor/hooks.json").hooks;
    expect(hooks.stop.map((h: any) => h.command)).toEqual(["lint", "kane-loop-hook cursor"]);
    expect(hooks.afterFileEdit).toHaveLength(1);
    expect(j(d, ".kane-loop.json").maxIterations).toBe(5);
    expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toMatch(/^# Rules\nBe nice\.\n\n<!-- kane-loop -->/);
    const gi = readFileSync(join(d, ".gitignore"), "utf8");
    expect(gi.match(/\.kane-loop\//g)).toHaveLength(1);
    expect(gi).toContain(".testmuai/evidence/");
  });

  it("dry run writes nothing", () => {
    const d = tmp();
    const ch = runInit(d, { dryRun: true });
    expect(ch.length).toBeGreaterThan(0);
    expect(() => readFileSync(join(d, ".mcp.json"))).toThrow();
  });

  it("refuses to clobber invalid JSON", () => {
    const d = tmp();
    writeFileSync(join(d, ".mcp.json"), "{oops");
    expect(() => runInit(d)).toThrow(/not valid JSON/);
  });
});
