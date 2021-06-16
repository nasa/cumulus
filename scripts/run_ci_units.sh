#!/bin/bash
npx lerna run --ignore @cumulus/cumulus-integration-tests --concurrency 1 test > ./test_output.txt 2>&1
RESULT=$?
cat ./test_output.txt
printf '\n\n\n*****TEST FAILURES:\n'
grep '✖' ./test_output.txt
exit $RESULT
