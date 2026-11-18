---
url: "http://127.0.0.1:5173"
mode: testing
max_steps: 50
timeout: 240
target: chrome
headless: true
---

# Session: splitly-even-split

## Step 1
Click Reset. Add people named Ana, Ben and Cara. Add an expense 'Taxi' of 10.00 paid by Ana, split among all three. Verify the balances say 'Ana is owed €6.66', 'Ben owes €3.33' and 'Cara owes €3.33'. Click Settle up and verify the transfers are exactly 'Ben pays Ana €3.33' and 'Cara pays Ana €3.33'.
