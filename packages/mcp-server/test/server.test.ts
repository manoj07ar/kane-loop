import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

describe("MCP server", () => {
  it("lists tools and calls verify_with_kane + loop_status", async () => {
    process.env.FAKE_KANE_SCENARIO = "pass";
    const eventsDir = await mkdtemp(join(tmpdir(), "kl-"));
    const server = createServer({ bin: resolve(__dirname, "fake-kane.mjs"), eventsDir });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_failure", "loop_status", "replay_tests", "verify_with_kane"]);
    const rp = await client.callTool({ name: "replay_tests", arguments: {} });
    expect((rp.structuredContent as { status: string }).status).toBe("pass");
    const res = await client.callTool({ name: "verify_with_kane", arguments: { url: "http://localhost:3000", objective: "x" } });
    expect((res.structuredContent as { status: string }).status).toBe("pass");
    const st = await client.callTool({ name: "loop_status", arguments: {} });
    expect((st.structuredContent as { state: string; passes: number }).state).toBe("green");
    expect((st.structuredContent as { passes: number }).passes).toBe(1);
  });
});
