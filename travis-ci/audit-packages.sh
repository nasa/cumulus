#!/bin/sh

set -e

echo "starting package audit"

(
  npm run audit
  result=$?

  echo "===== LERNA DEBUG LOG ====="
  cat ./lerna-debug.log

  echo "===== NPM DEBUG LOG ======="
  cat /home/travis/.npm/_logs/*-debug.log
)

exit $result