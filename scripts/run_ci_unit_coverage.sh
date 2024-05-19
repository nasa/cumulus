#!/bin/bash
export UNIT_TEST_BUILD_DIR=$(pwd);
# touch ./test_output.txt
# tail -f ./test_output.txt &
# TAIL_PID=$!

npm run test:ci

RESULT=$?

# kill -9 $TAIL_PID

# if [[ $RESULT != 0 ]]
# then
#     printf '\n\n\n*****TEST FAILURES:\n'
#     grep '✘' ./test_output.txt
#     exit $RESULT
# fi
npm run coverage -- --noRerun
exit $RESULT