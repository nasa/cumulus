#!/bin/sh

set +e

TESTS=$(find spec/parallel/ingestGranule -type f -name '*spec.js' -or -name '*Spec.js')

testOutputDir=scripts/test_output

rm -r -f $testOutputDir
mkdir -p $testOutputDir

./node_modules/.bin/parallel -D sh scripts/runtest.sh  $testOutputDir ::: $TESTS

result=$?

echo tests exited $result

for testFile in $(find $testOutputDir -type f); do
  cat $testFile
done

rm -rf $testOutputDir

echo $result
exit $result