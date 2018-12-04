#!/bin/sh

echo "Starting package vulnerability audit.."

(
  set -e
  npm run audit-root
  npm run audit
)
result=$?

echo "Test finished with exit code $result"
exit $result