#!/bin/bash
export UNIT_TEST_BUILD_DIR=$(pwd);
touch ./test_output.txt
tail -f ./test_output.txt &
TAIL_PID=$!

npm --prefix=packages/api run test:ci > ./test_output.txt

npm run test:ci -- --ignore @cumulus/api > ./test_output.txt

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
npm run coverage -- --noRerun
exit $RESULT