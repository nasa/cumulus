#!/bin/bash
export UNIT_TEST_BUILD_DIR=$(pwd);
touch ./test_output.txt
tail -f ./test_output.txt &
TAIL_PID=$!

npm run test:ci > ./test_output.txt 2>&1
RESULT=$?
if [ -n "$(ls -A ./unit-logs/@cumulus 2>/dev/null)" ]
then 
    aws s3 sync unit-logs/@cumulus/ s3://unit-test-error-logs/$(git rev-parse --abbrev-ref HEAD)/$(date +%Y-%m-%dT%H.%M.%S)/
fi

kill -9 $TAIL_PID
if [ $RESULT ]
then
    return $RESULT
fi
npm run coverage -- --noRerun
return $RESULT