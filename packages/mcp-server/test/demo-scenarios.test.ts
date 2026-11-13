import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/loop.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const scenarios = join(root, "demo", "scenarios");

describe("demo scenarios and repo flows", () => {
  const patches = readdirSync(scenarios).filter((f) => f.endsWith(".patch"));

  it("ships at least two seeded-bug scenarios", () => {
    expect(patches.length).toBeGreaterThanOrEqual(2);
  });

  for (const p of patches) {
    it(`${p} still applies cleanly to the demo app`, () => {
      expect(() => execFileSync("git", ["apply", "--check", join(scenarios, p)], { cwd: root, stdio: "pipe" })).not.toThrow();
    });
  }

  it("the repo's .kane-loop.json loads with both Splitly flows", async () => {
    const cfg = await loadConfig(root);
    expect(cfg.flows.map((f) => f.name)).toEqual(["splitly-even-split", "splitly-settle-visible"]);
    const obj = cfg.flows[0]?.objective ?? "";
    for (const s of ["Ana is owed €6.66", "Ben owes €3.33", "Cara owes €3.33", "Ben pays Ana €3.33", "Cara pays Ana €3.33"]) expect(obj).toContain(s);
    expect(JSON.parse(readFileSync(join(root, ".kane-loop.json"), "utf8")).maxIterations).toBe(3);
  });
});
