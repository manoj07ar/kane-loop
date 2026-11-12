import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { verifyWithKane } from "./kane.js";
import { computeStatus, readEvents } from "./loop.js";
import { replayTests, getFailure } from "./testrun.js";

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

  server.tool(
    "replay_tests",
    "Replay the saved Kane flows (*_test.md) in a real browser. Costs 0 credits. Call after every change before saying you're done; returns which flows failed and why.",
    {
      paths: z.array(z.string()).optional().describe("Specific *_test.md files or folders; default is every saved flow"),
      match: z.string().optional().describe("Regex on project-relative path to pick flows"),
      tags: z.array(z.string()).optional().describe("Only flows with any of these frontmatter tags"),
      fail_fast: z.boolean().optional().describe("Stop at the first failing flow"),
    },
    async (args) => {
      const result = await replayTests({ paths: args.paths, match: args.match, tags: args.tags, failFast: args.fail_fast }, opts);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result },
        isError: result.status === "pass" ? undefined : true,
      };
    },
  );

  server.tool(
    "get_failure",
    "Read the evidence for a failed flow: failing step, its heading, Kane's remarks and screenshots. Pass log_path from a replay_tests failure.",
    { log_path: z.string().min(1).describe("log_path of the failed member from replay_tests") },
    async ({ log_path }) => {
      try {
        const result = await getFailure(log_path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: { ...result } };
      } catch (e) {
        return { content: [{ type: "text", text: `Could not read ${log_path}: ${String(e)}` }], isError: true };
      }
    },
  );

  return server;
}
