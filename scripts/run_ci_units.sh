#!/bin/bash
touch ./test_output.txt
tail -f ./test_output.txt &
npx lerna run --ignore @cumulus/cumulus-integration-tests --concurrency 1 test > ./test_output.txt 2>&1
RESULT=$?
printf '\n\n\n*****TEST FAILURES:\n'
grep '✖' ./test_output.txt
exit $RESULT
