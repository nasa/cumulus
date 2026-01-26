#!/bin/sh

# This is a script for running a certain test repeatedly to debug intermittent test fails
# Run like this:
# DEPLOYMENT=<deployment> scripts/repeat-test.sh spec/parallel/ingestGranule/IngestGranuleSuccessSpec.js test-output/<resultsFolder>
# The console output will show how many total runs and how many failed runs
# Test output for failed tests will be saved to the test-output/<resultsFolder>
# test-output/<resultsFolder> will be cleaned out when the test is started

set +e

specName=$(echo $1 | rev | cut -d'/' -f 1 | cut -d'.' -f 2 | rev)

outputDir="test-output/$2"

echo Running test $specName on repeat and logging to directory $outputDir

rm -r -f $outputDir
mkdir -p $outputDir

count=0
failureCount=0

while [ true ]
do
  outputPath="$outputDir/$specName-$(date "+%Y%m%d-%H:%M:%S")"

  ../node_modules/.bin/jasmine "$1" > "$outputPath" 2>&1
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
