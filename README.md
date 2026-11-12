# Kane Loop

> Your coding agent can't say "done" until Kane says green.

Work in progress for the Kane CLI Online Hackathon (12–19 Nov 2026).

An MCP server that gives any agent a `verify_with_kane` tool, backed by [Kane CLI](https://www.testmuai.com/support/docs/kane-cli-introduction).

## Layout
- `packages/mcp-server`: MCP server (stdio). Tools: `verify_with_kane(url, objective, name?, timeout?)` and `loop_status()` (green/red/verifying, red iteration count, last result, all read from the event log).
- `kane-loop-hook <claude|cursor>`: stop hook. After every agent turn it re-runs the flows in `.kane-loop.json` with Kane CLI. Green lets the agent stop. Red blocks the stop and hands the agent Kane's failing-step remark as its next instruction (Claude Code `decision: block`, Cursor `followup_message`), up to `maxIterations` (default 3). If Kane can't start (login or credits), it reports that and doesn't loop.
- `apps/demo`: Splitly, the bill-splitter the agent works on.
- `apps/console`: placeholder for the live Loop Console.

## Wire up the loop

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
Matches Cursor's documented `stop` hook: stdin carries `status` and `loop_count`, and a non-empty `followup_message` on stdout is auto-submitted as the next user message. Kane runs a real browser, so give the hook a generous `timeout` (seconds), and keep `loop_limit` equal to `maxIterations`. The hook also reads `loop_count`, so it stops looping even if `loop_limit` is higher. The repo is found from `workspace_roots` / `CURSOR_PROJECT_DIR` (set `KANE_LOOP_DIR` to override).

## Develop
```
pnpm install
pnpm typecheck && pnpm test
```
Set `KANE_CLI_BIN` to use a different kane-cli binary (tests use a fake script). Events are appended to `.kane-loop/events.jsonl`.

## Licence
MIT
