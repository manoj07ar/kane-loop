# Demo scenarios

Two bugs a coding agent could plausibly write, each caught by one of the Splitly flows in `.kane-loop.json`. They back up the live demo: if the agent's own edit during recording happens to be correct, seed one of these so the red-to-green loop is still real Kane output, not a mock. Say in the video when a bug was seeded.

| Scenario | What changes | Flow that goes red | What Kane should see |
| --- | --- | --- | --- |
| `01-rounding` | `splitEvenly` gives everyone the same rounded share instead of handing out leftover cents | `splitly-even-split` | €10 between three shows "Ana is owed €6.67" and transfers of €3.33 + €3.33, so €0.01 is lost |
| `02-mobile-settle` | the settle section gets a 720px min-width and the button is pushed right | `splitly-settle-visible` | at phone width the Settle up button is clipped off-screen |

Recording run:

```
scripts/demo.sh reset
pnpm --filter @kane-loop/demo dev          # Splitly on http://127.0.0.1:5173
node apps/console/server.mjs .             # Loop Console
scripts/demo.sh seed 01-rounding           # only if the agent's edit didn't break anything
# ask the agent: "Tidy up splitEvenly in apps/demo/src/split.ts", let it end its turn,
# the stop hook runs Kane, goes red, and hands the agent the failing step
scripts/demo.sh reset                      # afterwards
```

Still to confirm on the first real Kane run (needs `kane-cli login`): that the exact balance strings match what Kane reads, and whether Kane's browser runs at a phone width for `02-mobile-settle` (if not, the flow needs a viewport step or a narrower window).
