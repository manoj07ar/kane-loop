# Loop Console

A live view of the Kane Loop: every agent turn, the Kane runs it triggered, which step failed, what the agent was told, and the green re-run.

- Live: `pnpm --filter @kane-loop/console build && node apps/console/server.mjs <repoDir>` then open http://127.0.0.1:4310. The server tails `<repoDir>/.kane-loop/events.jsonl` (written by the MCP server and stop hooks) over Server-Sent Events.
- Read-only replay (no credentials): open `/?replay` to play the bundled example, or `/?replay=<url-to-events.jsonl>&speed=8` for a recorded session. The bundled `public/sample-loop.jsonl` is example data, not a real Kane run.

Kane remarks are rendered as plain text, never HTML.
