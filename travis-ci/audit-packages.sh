#!/bin/sh

echo "Starting package vulnerability audit.."

(
  set -e
  npm run audit
)
result=$?

echo "===== LERNA DEBUG LOG ====="
cat ./lerna-debug.log

echo "Test finished with exit code $result"
exit $result