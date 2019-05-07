#!/bin/sh

set +e

echo Running parallel integration tests

# print a dot to output every minute for travis
(while true; do sleep 60; echo .; done) &
DOT_PID="$!"

TESTS=$(find spec/parallel -type f -name '*spec.js' -or -name '*Spec.js')
testOutputDir=scripts/test_output

rm -r -f $testOutputDir
mkdir -p $testOutputDir

echo "" | ./node_modules/.bin/parallel -j 6 sh scripts/run_test.sh  $testOutputDir ::: $TESTS
result=$?
echo parallel tests complete: $result suite failures

# print test output to console
for testFile in $testOutputDir/*; do
  cat $testFile
done

rm -rf $testOutputDir

kill "$DOT_PID"
exit $result
