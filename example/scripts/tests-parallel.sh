#!/bin/sh

set +e

echo Running parallel integration tests

(while true; do sleep 60; echo .; done) &
DOT_PID="$!"

TESTS=$(find spec/parallel -type f -name '*spec.js' -or -name '*Spec.js')

testOutputDir=scripts/test_output

rm -r -f $testOutputDir
mkdir -p $testOutputDir

./node_modules/.bin/parallel sh scripts/run_test.sh  $testOutputDir ::: $TESTS

result=$?

echo parallel tests complete: $result suite failures

for testFile in $testOutputDir/*; do
  cat $testFile
done

rm -rf $testOutputDir

kill "$DOT_PID"
exit $result
