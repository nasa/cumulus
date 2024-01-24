 #!/bin/bash
touch ./test_output.txt
tail -f ./test_output.txt &
TAIL_PID=$!
npx lerna run --ignore @cumulus/cumulus-integration-tests --concurrency 1 test:coverage > ./test_output.txt 2>&1
RESULT=$?
printf '\n\n\n*****TEST FAILURES:\n'
grep '✖' ./test_output.txt
kill -9 $TAIL_PID
npx lerna run --ignore @cumulus/cumulus-integration-tests --concurrency 1 coverage -- --noRerun > ./test_output.txt 2>&1
RESULT=$?
exit $RESULT
