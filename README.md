# Kane Loop

> Your coding agent can't say "done" until Kane says green.

Work in progress for the Kane CLI Online Hackathon (12–19 Nov 2026).

An MCP server that gives any agent a `verify_with_kane` tool, backed by [Kane CLI](https://www.testmuai.com/support/docs/kane-cli-introduction).

## Layout
- `packages/mcp-server`: MCP server (stdio). Tools: `verify_with_kane(url, objective, name?, timeout?)`, `loop_status()` (stub).
- `apps/console`, `apps/demo`: placeholders.

## Develop
```
pnpm install
pnpm typecheck && pnpm test
```
Set `KANE_CLI_BIN` to use a different kane-cli binary (tests use a fake script). Events are appended to `.kane-loop/events.jsonl`.

## Licence
MIT
