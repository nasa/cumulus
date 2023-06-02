#!/bin/sh

set +e

specName=$(echo "$2" | rev | cut -d'/' -f 1 | cut -d'.' -f 2 | rev)
outputPath="${1}/${specName}-running.txt"

TIMESTAMP=$(date "+%Y-%m-%dT%H:%M:%S")
echo "$TIMESTAMP ../node_modules/.bin/jasmine $2 STARTED"

../node_modules/.bin/jasmine --no-color "$2" > "$outputPath" 2>&1
result=$?

TIMESTAMP=$(date "+%Y-%m-%dT%H:%M:%S")
if [ "$result" -eq "0" ]; then
  echo "$TIMESTAMP ../node_modules/.bin/jasmine $2 PASSED"
  mv "$outputPath" "$1/${specName}-passed.txt"
else
  echo "$TIMESTAMP ../node_modules/.bin/jasmine $2 FAILED"
  mv "$outputPath" "$1/${specName}-failed.txt"
fi

exit $result
