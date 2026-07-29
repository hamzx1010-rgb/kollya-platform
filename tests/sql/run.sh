#!/usr/bin/env bash
# Postgres/RLS tests. Needs a local postgres; skips cleanly without one.
cd "$(dirname "$0")/../.."
out=$(bash tests/sql/rls.test.sh 2>&1)
line=$(echo "$out" | grep -E "^[0-9]+/[0-9]+ passed" | tail -1)
if echo "$out" | grep -q "^FAIL"; then
  echo "  ✗ sql/rls: $line"; echo "$out" | grep "^FAIL" | sed 's/^/      /'; exit 1
elif [ -z "$line" ]; then
  echo "  – sql/rls: skipped ($(echo "$out" | tail -1))"; exit 0
else
  echo "  ✓ sql/rls: $line"; exit 0
fi
