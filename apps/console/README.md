# Loop Console

A live view of the Kane Loop: every agent turn, the Kane runs it triggered, which step failed, what the agent was told, and the green re-run.

- Live: `pnpm --filter @kane-loop/console build && node apps/console/server.mjs <repoDir>` then open http://127.0.0.1:4310. The server tails `<repoDir>/.kane-loop/events.jsonl` (written by the MCP server and stop hooks) over Server-Sent Events.
- Read-only replay (no credentials): open `/?replay` to play the bundled recording, or `/?replay=<url-to-events.jsonl>&speed=8` for another session. The bundled `public/sample-loop.jsonl` is a real recorded Kane CLI 0.10.3 loop from 18 Nov 2026 (save the flow, seeded rounding bug goes red, reset goes green, 0-credit replay green), with the failure screenshot in `public/real-loop-2026-11-18/`. Raw unedited logs: `demo/recordings/2026-11-18-01-rounding`.

Kane remarks are rendered as plain text, never HTML.
