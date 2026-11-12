import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { verifyWithKane } from "./kane.js";
import { computeStatus, readEvents } from "./loop.js";

export function createServer(opts: { eventsDir?: string; bin?: string } = {}): McpServer {
  const server = new McpServer({ name: "kane-loop", version: "0.0.1" });

  server.tool(
    "verify_with_kane",
    "Verify a running web app in a real browser with Kane CLI. Give the URL and a plain-English objective (what to do and what to verify). Returns pass/fail with the failing step's remark.",
    {
      url: z.string().url().describe("URL of the app to test"),
      objective: z.string().min(1).describe("What to do and verify, e.g. 'add an expense of 100 and verify total shows 100.00'"),
      name: z.string().optional().describe("Optional slug; saves the flow as a replayable test"),
      timeout: z.number().int().positive().optional().describe("Seconds before Kane gives up (default 180)"),
    },
    async (args) => {
      const result = await verifyWithKane(args, opts);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result },
        isError: result.status === "fail" || result.status === "error" ? true : undefined,
      };
    },
  );

  server.tool("loop_status", "Report the Kane Loop state from the event log: green/red/verifying, current red iteration, run counts and the last result.", {}, async () => {
    const result = computeStatus(await readEvents(opts.eventsDir ?? process.cwd()));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: { ...result } };
  });

  return server;
}
