#!/bin/bash

set +e

echo Running parallel integration tests

# print a dot to output every minute for CI
(while true; do sleep 60; echo .; done) &
DOT_PID="$!"

TESTS=$(find spec/parallel -type f -name '*spec.js' -or -name '*Spec.js')
testOutputDir=scripts/test_output
testTimeout=1200

rm -r -f $testOutputDir
mkdir -p $testOutputDir

echo "" | ../node_modules/.bin/parallel -j "${INTEGRATION_CONCURRENCY:=0}" sh scripts/run_test.sh  $testOutputDir $testTimeout ::: $TESTS
result=$?
echo parallel tests complete: $result suite failures

# print test output to console
find "$testOutputDir" -mindepth 1 -maxdepth 1 -name '*-passed.txt' -exec cat {} \;
echo "********* FAILED TESTS ***************"
find "$testOutputDir" -mindepth 1 -maxdepth 1 -name '*-failed.txt' -exec cat {} \;
echo '**************************************'

rm -rf $testOutputDir

kill "$DOT_PID"
exit $result
