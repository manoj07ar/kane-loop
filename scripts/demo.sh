#!/usr/bin/env bash
# Demo helper for recording Kane Loop. Seeds a known bug into Splitly so the
# loop has something real to catch, and resets it afterwards.
#   scripts/demo.sh list            list scenarios
#   scripts/demo.sh seed <name>     apply demo/scenarios/<name>.patch
#   scripts/demo.sh reset           restore apps/demo/src and clear .kane-loop/events.jsonl
#   scripts/demo.sh status          show which demo files differ from HEAD
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
dir=demo/scenarios
case "${1:-}" in
  list) for p in "$dir"/*.patch; do basename "$p" .patch; done ;;
  seed)
    name="${2:?usage: demo.sh seed <name>}"; p="$dir/$name.patch"
    [[ -f "$p" ]] || { echo "no scenario $name (try: demo.sh list)" >&2; exit 1; }
    if ! git diff --quiet -- apps/demo/src; then echo "apps/demo/src has changes; run demo.sh reset first" >&2; exit 1; fi
    git apply "$p" && echo "seeded $name" ;;
  reset)
    git checkout -- apps/demo/src
    rm -f .kane-loop/events.jsonl
    echo "demo app restored, event log cleared" ;;
  status) git status --short -- apps/demo/src .kane-loop 2>/dev/null || true ;;
  *) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
