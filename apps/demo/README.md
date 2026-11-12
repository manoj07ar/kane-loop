# Splitly (demo app)

A tiny bill splitter used as the target app for Kane Loop. Add people, add expenses, see who owes whom, and settle up. Money is stored as whole cents, and uneven splits hand out leftover cents so totals always match.

```
pnpm --filter @kane-loop/demo dev    # http://127.0.0.1:5173
pnpm --filter @kane-loop/demo test
```

State lives in localStorage, so there's no backend and no login.
