#!/usr/bin/env bash
# Real-Chrome test runner. Unlike tests/run.sh (jsdom, no layout), these
# boot the actual app in headless Chrome against a local PostgREST +
# Better-Auth look-alike, so they can measure pixels, contrast and
# popup direction.
cd "$(dirname "$0")/../.."
[ -d node_modules/puppeteer ] || npm install --no-save --silent puppeteer
failed=0
for f in tests/browser/*.test.mjs; do
  name=$(basename "$f" .test.mjs)
  out=$(node "$f" 2>&1)
  line=$(echo "$out" | grep -E "^[0-9]+/[0-9]+ passed" | tail -1)
  if echo "$out" | grep -q "^FAIL"; then
    echo "  ✗ browser/$name: $line"
    echo "$out" | grep "^FAIL" | sed 's/^/      /'
    failed=1
  else
    echo "  ✓ browser/$name: $line"
  fi
done
exit $failed
