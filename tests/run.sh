#!/usr/bin/env bash
# Koliya test runner. Tests live here (not /tmp) so they survive.
cd "$(dirname "$0")/.."
[ -d node_modules/jsdom ] || npm install --silent jsdom
total=0; passed=0; failed=0
for f in tests/*.test.mjs; do
  out=$(node --experimental-vm-modules "$f" 2>&1 | grep -vE "MODULE_TYPELESS|Reparsing|eliminate|trace-warnings|localStorage indisponible|ExperimentalWarning|VM Modules")
  line=$(echo "$out" | grep -E "^[0-9]+/[0-9]+ passed" | tail -1)
  fails=$(echo "$out" | grep -c "^FAIL")
  name=$(basename "$f" .test.mjs)
  if [ -n "$line" ]; then
    p=${line%%/*}; t=${line#*/}; t=${t%% *}
    total=$((total+t)); passed=$((passed+p))
    [ "$fails" -gt 0 ] && { echo "  ✗ $name: $line"; echo "$out" | grep "^FAIL" | sed 's/^/      /'; failed=1; } \
                       || echo "  ✓ $name: $line"
  else
    echo "  ✗ $name: CRASHED"; echo "$out" | tail -5 | sed 's/^/      /'; failed=1
  fi
done
echo "  ─────────────────────────"
echo "  TOTAL: $passed/$total"
exit $failed
