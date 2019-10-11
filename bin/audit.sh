#!/bin/sh

echo 'Starting package audit ...'

AUDIT_LOG="tmp/audit-ci.log"

mkdir -p tmp

(
  audit-ci --config ./audit-ci.json && \
  lerna exec -- audit-ci --config "$(pwd)/audit-ci.json"
) > "$AUDIT_LOG" 2>&1
AUDIT_RESULT="$?"

grep 'the audit endpoint may be temporarily unavailable' "$AUDIT_LOG" > /dev/null 2>&1
GREP_RESULT="$?"

cat "$AUDIT_LOG"
rm "$AUDIT_LOG"

if [ "$AUDIT_RESULT" -eq "0" ]; then
  exit 0
else
  if [ "$GREP_RESULT" -eq "0" ]; then
    echo "The NPM audit endpoint was unavailable." >&2
    exit 0
  else
    exit $AUDIT_RESULT
  fi
fi
