# Real recorded Kane Loop run: 01-rounding (18 Nov 2026)

This is real Kane CLI output, not example data. It was recorded on the dev box on Wed 18 Nov 2026 between 14:53 and 15:05 Irish time, with kane-cli 0.10.3 logged in by OAuth and Splitly (`apps/demo`) running on http://127.0.0.1:5173 under `pnpm --filter @kane-loop/demo dev`. The only edits are that local paths were shortened (repo prefix removed, `/home/box` became `~`) and Test Manager share links were redacted.

| # | What ran | Result | Credits |
| --- | --- | --- | --- |
| 1 | `verify_with_kane` over MCP stdio (`packages/mcp-server/dist/index.js`) for `splitly-even-split`, with `name`, so kane-cli saved `.testmuai/tests/splitly-even-split_test.md` | green in 89 s, "Ana is owed €6.66, Ben owes €3.33, Cara owes €3.33; Ben pays Ana €3.33, Cara pays Ana €3.33" | 33.0 |
| 2a | `scripts/demo.sh seed 01-rounding`, then the Cursor stop hook (`kane-loop-hook cursor`) replays the saved flow. This is from before the parser fix. | red, but the feedback only said `assertion_failed: @ step 20` | about 3.6 |
| 2b | Same seeded bug, hook re-run after the parser fix | red: "Kane action 20: assertion failed: the balances say 'Ana is owed €6.66' ... Checks that came back false: ana_owed_6_66_balance", screenshot `screenshots/step_020.png` | about 6.3 (replay failure, then adaptive heal re-authored) |
| 3 | `scripts/demo.sh reset`, then the hook (iteration 2) | red for the wrong reason: "No start URL provided". Adaptive heal had replaced the recording, and the saved `_test.md` had no `url:`. This was a Kane Loop bug and is now fixed (`ensureStartUrl`). | about 0.6 |
| 4 | Start URL pinned, hook re-run with the red log from 2b restored | green (Kane re-authored the flow, because heal had replaced it in 2b, then committed it) | 30.3 |
| 5 | Hook again, a pure replay | green in 15 s, `replay_decisions: 1` | 0 |

Total for the session: 1200 → 1123.64 credits (76.4 used).

Files:
- `raw/*.events.jsonl` are the Kane Loop event logs (`.kane-loop/events.jsonl`) as written by the MCP server and the stop hook. `raw/4-hook-red-then-green-final.events.jsonl` is the clean red, green, green loop.
- `raw/*-member-*.events.ndjson` are kane-cli's own per-member testrun logs (the `log_path` that `get_failure` reads).
- `raw/*.followup.json` is exactly what the Cursor stop hook printed for the agent.
- `screenshots/step_017.png` and `step_020.png` are Kane's screenshots from the red replay. The balances sit below the fold at 1920x1080, so they don't show the wrong number. Show the app itself in the video.
- `splitly-even-split_test.md` is the saved flow with its pinned start URL.

`apps/console/public/sample-loop.jsonl` is runs 1 and 4 together (run 3 is left out), so the Loop Console `/?replay` mode plays this real loop.

What we learned from the real runs:
- A replay is not always free. A green replay cost 0, but a red replay cost about 3.6 to 6.3 credits (failure investigation plus adaptive heal), and after a heal replaced the recording, the next green had to re-author (about 30).
- Kane replays at 1920x1080, so `02-mobile-settle` needs a viewport step, `kane-cli config set-window`, or a narrower window before it can catch the clipped button.
