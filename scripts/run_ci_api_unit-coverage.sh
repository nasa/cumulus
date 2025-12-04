#!/bin/bash
export UNIT_TEST_BUILD_DIR=$(pwd);
touch ./test_output.txt
tail -f ./test_output.txt &
TAIL_PID=$!

npm run test:ci:api-units > ./test_output.txt

RESULT=$?
# make sure tail has gotten everything out
sleep 2
kill -9 $TAIL_PID

if [[ $RESULT != 0 ]]
then
    printf '\n\n\n*****TEST FAILURES:\n'
    grep '✘' ./test_output.txt
    exit $RESULT
fi
npm run coverage:api -- --noRerun
exit $RESULT