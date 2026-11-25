# Kane Loop

> Your coding agent can't say "done" until Kane says green.

Built for the [Kane CLI Online Hackathon](https://www.kaneclihack.sh/) (12–26 Nov 2026).

An MCP server that gives any agent a `verify_with_kane` tool, backed by [Kane CLI](https://www.testmuai.com/support/docs/kane-cli-introduction). Public repo: https://github.com/manoj07ar/kane-loop

## Demo video

The 3–5 minute walkthrough will be linked here once it's on YouTube (unlisted is fine):

**Demo video:** _to be added after recording._

## Proof: a real recorded loop

[`demo/recordings/2026-11-18-01-rounding`](demo/recordings/2026-11-18-01-rounding) is real Kane CLI 0.10.3 output from 18 Nov 2026, not example data: a live `verify_with_kane` save went green, a seeded rounding bug went red through the Cursor stop hook (Kane's failing step and screenshot were handed to the agent as its next instruction), the reset went green, and a pure replay went green for 0 credits. 76.4 credits for the whole session. The raw event logs, the exact stop-hook follow-up JSON and Kane's screenshots are in that folder, and the Loop Console's replay mode plays this same run.

## Run it

You need Node 18+ and [pnpm](https://pnpm.io/). A Kane CLI login is not required to run the demo app or to replay the recorded loop.

```bash
pnpm install
pnpm --filter @kane-loop/demo dev
# Splitly, the bill-splitter, at http://127.0.0.1:5173
```

In a second terminal, replay the 18 Nov loop in the Loop Console:

```bash
pnpm --filter @kane-loop/console build
node apps/console/server.mjs .
# open http://127.0.0.1:4310/?replay
```

## Layout
- `packages/mcp-server`: MCP server (stdio). Tools: `verify_with_kane(url, objective, name?, timeout?)` and `loop_status()` (green/red/verifying, red iteration count, last result, all read from the event log).
- `kane-loop-hook <claude|cursor>`: stop hook. After every agent turn it replays the repo's saved Kane flows (`.testmuai/tests/*_test.md`, via `kane-cli testrun run`, 0 credits) or, if there are none yet, re-runs the live flows in `.kane-loop.json`. Set `"replay": { "paths": [...], "match": "...", "tags": [...] }` to choose which saved flows run, or `"replay": false` to force live runs. Green lets the agent stop. Red blocks the stop and hands the agent Kane's failing-step remark as its next instruction (Claude Code `decision: block`, Cursor `followup_message`), up to `maxIterations` (default 3). If Kane can't start (login or credits), it reports that and doesn't loop.
- `apps/demo`: Splitly, the bill-splitter the agent works on.
- `demo/scenarios`: two seeded-bug patches (rounding, clipped Settle up button) and `scripts/demo.sh` to seed and reset them while recording. The repo's own `.kane-loop.json` runs the two Splitly flows that catch them.
- `apps/console`: the Loop Console, a live timeline of agent turns and Kane runs (SSE), plus a read-only replay mode.

## Wire up the loop

The CLI is not published to npm yet. Clone this repo, build it, then run the commands from the repo root (or pass `--dir` to point at another project):

```bash
pnpm install
pnpm --filter @kane-loop/mcp-server build
node packages/mcp-server/dist/init-cli.js init --url http://127.0.0.1:5173
node packages/mcp-server/dist/init-cli.js doctor
```

`init` adds the MCP server for Cursor (`.cursor/mcp.json`) and Claude Code (`.mcp.json`), both stop hooks, a starter `.kane-loop.json`, a Kane Loop section in `AGENTS.md` and `.gitignore` entries. It merges into existing configs, never overwrites your `.kane-loop.json`, and is safe to re-run (`--dry-run` previews). `doctor` checks that kane-cli is installed and logged in, that you have credits, that `.kane-loop.json` has flows (and counts saved flows, which replay for 0 credits), that the stop hooks and MCP server are wired, and that your app URL answers. It exits 1 with a fix for each problem, so it also works as a CI or pre-demo gate (`--no-url` skips the app check).

Want Kane on every save too, not just at the end of the agent's turn? Run this in another terminal:

```bash
node packages/mcp-server/dist/init-cli.js watch
```

It watches the repo (skipping `node_modules`, `.git`, build output and Kane's own files), waits until saves settle (`--debounce 1500` ms by default, bursts collapse into one run), then replays the saved flows, or the live flows if there are none. Red prints Kane's failing step and writes it to `.kane-loop/last-failure.md` for you or your agent to read; green clears that file. Watch runs show up in the Loop Console as `watch_run` events and never count toward the stop hook's iteration cap.

The recorded loop in this repo used Cursor. The same hook and MCP server also wire up for Claude Code; that path is in the code, but the published proof is the Cursor run.

Or wire it by hand:

`.kane-loop.json` in the repo you're working on:
```json
{ "flows": [{ "url": "http://localhost:5173", "objective": "Add Ana and Ben, add a 100.00 expense paid by Ana split between both, verify Ben owes Ana 50.00" }], "maxIterations": 3 }
```

Claude Code (`.claude/settings.json`):
```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "kane-loop-hook claude" }] }] } }
```

Cursor (`.cursor/hooks.json`):
```json
{ "version": 1, "hooks": { "stop": [{ "command": "kane-loop-hook cursor", "timeout": 600, "loop_limit": 3 }] } }
```
Matches Cursor's documented `stop` hook: stdin carries `status` and `loop_count`, and a non-empty `followup_message` on stdout is auto-submitted as the next user message. Kane runs a real browser, so give the hook a generous `timeout` (seconds), and keep `loop_limit` equal to `maxIterations`. The hook also reads `loop_count`, so it stops looping even if `loop_limit` is higher. The repo is found from `workspace_roots` / `CURSOR_PROJECT_DIR` (set `KANE_LOOP_DIR` to override). If you have not installed the package as a dependency, point `command` at `node /absolute/path/to/kane-loop/packages/mcp-server/dist/hook-cli.js cursor`.

## Develop
```bash
pnpm install
pnpm typecheck && pnpm test
pnpm --filter @kane-loop/mcp-server build
```
Set `KANE_CLI_BIN` to use a different kane-cli binary (tests use a fake script). Events are appended to `.kane-loop/events.jsonl`.

## Licence
MIT
