#!/bin/sh

# TO DO: document this
# This repeats the same test and keeps logs for the ones that fails, also reports how many runs and how many fails
# I run this like: DEPLOYMENT=lf scripts/repeat-test.sh spec/parallel/ingestGranule/IngestGranuleSuccessSpec.js ingestGran


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


