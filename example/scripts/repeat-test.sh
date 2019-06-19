#!/bin/sh

# This is a script for running a certain test repeatedly to debug intermittent test fails
# Run like this:
# DEPLOYMENT=<deployment> scripts/repeat-test.sh spec/parallel/ingestGranule/IngestGranuleSuccessSpec.js <resultsFolder>
# The console output will show how many total runs and how many failed runs
# Test output for failed tests will be saved to the <resultsFolder>
# <resultsFolder> will be cleaned out when the test is started

set +e

specName=$(echo $1 | rev | cut -d'/' -f 1 | cut -d'.' -f 2 | rev)

echo Running test $specName on repeat and logging to directory $2

rm -r -f $2
mkdir -p $2

count=0
failureCount=0

while [ true ]
do
  outputPath="$2/$specName-$(date "+%Y%m%d-%H:%M:%S")"

  npx jasmine "$1" > "$outputPath" 2>&1
  result=$?

  count=`expr $count + 1`

  if [ $result -ne 0 ]; then
    failureCount=`expr $failureCount + 1`
    echo Failure in file $outputPath. $count runs, $failureCount fails.
  else
    echo $count runs, $failureCount fails.
    rm -f $outputPath
  fi
done


