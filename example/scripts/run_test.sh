#!/bin/bash

set +e

specName=$(echo "$3" | rev | cut -d'/' -f 1 | cut -d'.' -f 2 | rev)
outputPath="${1}/${specName}-running.txt"
testTimeout=$2

TIMESTAMP=$(date "+%Y-%m-%dT%H:%M:%S")
echo "$TIMESTAMP ../node_modules/.bin/jasmine $3 STARTED"
timeout "$testTimeout" ../node_modules/.bin/jasmine --no-color "$3" > "$outputPath" 2>&1
result=$?

TIMESTAMP=$(date "+%Y-%m-%dT%H:%M:%S")
if [ "$result" -eq "0" ]; then
  echo "$TIMESTAMP ../node_modules/.bin/jasmine $3 PASSED"
  mv "$outputPath" "$1/${specName}-passed.txt"
elif [[ ( "$result" -gt 124 && "$result" -lt 128 ) || "$result" -eq "137" ]]; then
  echo "$TIMESTAMP ../node_modules/.bin/jasmine $3 PASSED"
  mv "$outputPath" "$1/${specName}-passed.txt"
  result=1
else
  echo "$TIMESTAMP ../node_modules/.bin/jasmine $3 FAILED"
  mv "$outputPath" "$1/${specName}-failed.txt"
fi

exit $result