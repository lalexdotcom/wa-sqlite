#!/usr/bin/env bash
# Throwaway: each test file in its own runner invocation, bounded, so the
# file that hangs is named and every file is timed.
set -u
mkdir -p probe/logs
for f in test/*.test.js; do
  name=$(basename "$f" .test.js)
  start=$(date +%s)
  WTR_FILES="$f" WTR_TRACE=1 timeout "${PER_FILE_S:-600}" yarn test > "probe/logs/$name.log" 2>&1
  code=$?
  echo "PER-FILE $name exit=$code $(( $(date +%s) - start ))s $(grep -aoE '[0-9]+ passed, [0-9]+ failed' "probe/logs/$name.log" | tail -1)"
  if [ "$code" = 124 ]; then
    echo "  last specs:"; grep -a 'PROBE-SPEC' "probe/logs/$name.log" | tail -5 | sed 's/^/    /'
    if [ "${RUNNER_OS:-}" = Windows ]; then
      taskkill //F //T //IM firefox.exe > /dev/null 2>&1
      taskkill //F //T //IM geckodriver.exe > /dev/null 2>&1
      taskkill //F //T //IM node.exe > /dev/null 2>&1
    fi
  fi
done
