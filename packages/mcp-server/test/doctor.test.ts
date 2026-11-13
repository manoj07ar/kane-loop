import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.js";
import { runInit } from "../src/init.js";

const bin = resolve(__dirname, "fake-kane.mjs");
const tmp = () => mkdtempSync(join(tmpdir(), "kl-doc-"));
const level = (cs: { name: string; level: string }[], n: string) => cs.find((c) => c.name === n)?.level;

afterEach(() => { delete process.env.FAKE_KANE_SCENARIO; });

describe("kane-loop doctor", () => {
  it("is all green on an initialised repo with a logged-in kane-cli", async () => {
    const d = tmp();
    runInit(d);
    const cs = await runDoctor(d, { bin, checkUrl: false });
    expect(cs.filter((c) => c.level === "fail")).toEqual([]);
    expect(cs.find((c) => c.name === "credits")?.detail).toBe("9840 credits");
    expect(level(cs, "hooks")).toBe("ok");
  });

  it("flags missing login, missing config and missing hooks", async () => {
    process.env.FAKE_KANE_SCENARIO = "noauth";
    const cs = await runDoctor(tmp(), { bin, checkUrl: false });
    expect(level(cs, "login")).toBe("fail");
    expect(cs.find((c) => c.name === "login")?.fix).toContain("kane-cli login");
    expect(level(cs, "config")).toBe("fail");
    expect(level(cs, "hooks")).toBe("fail");
  });

  it("fails on 0 credits and on a missing binary", async () => {
    process.env.FAKE_KANE_SCENARIO = "broke";
    expect(level(await runDoctor(tmp(), { bin, checkUrl: false }), "credits")).toBe("fail");
    expect(level(await runDoctor(tmp(), { bin: "/nope/kane-cli", checkUrl: false }), "kane-cli")).toBe("fail");
  });

  it("counts saved flows and probes the app URL", async () => {
    const srv = createServer((_q, r) => r.end("ok"));
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    const port = (srv.address() as { port: number }).port;
    const d = tmp();
    runInit(d, { url: `http://127.0.0.1:${port}` });
    mkdirSync(join(d, ".testmuai/tests"), { recursive: true });
    writeFileSync(join(d, ".testmuai/tests/settle_test.md"), "# flow");
    const cs = await runDoctor(d, { bin });
    srv.close();
    expect(cs.find((c) => c.name === "config")?.detail).toContain("1 saved flow");
    expect(level(cs, "app")).toBe("ok");
  });
});
