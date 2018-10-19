#!/bin/sh

JASMINE="jasmine --no-color"

TESTS_FAILED="FALSE"

$JASMINE |\
   tee default.log &
default_PID="$!"

$JASMINE spec/kinesisTests/KinesisTestErrorSpec.js |\
   tee KinesisTestErrorSpec.log &
KinesisTestErrorSpec_PID="$!"

# $JASMINE spec/ingestGranule/IngestGranuleSuccessSpec.js |\
#   tee IngestGranuleSuccessSpec.log &
# IngestGranuleSuccessSpec_PID="$!"

$JASMINE spec/bulkDelete/bulkDeleteSpec.js |\
  tee bulkDeleteSpec.log &
bulkDeleteSpec_PID="$!"

echo "Waiting for spec/kinesisTests/KinesisTestErrorSpec.js"
wait "$KinesisTestErrorSpec_PID"
if [ "$?" -ne "0" ]; then
  TESTS_FAILED="TRUE"
  KinesisTestErrorSpec_FAILED="TRUE"
fi

# echo "Waiting for spec/ingestGranule/IngestGranuleSuccessSpec.js"
# wait "$IngestGranuleSuccessSpec_PID"
# if [ "$?" -ne "0" ]; then
#   TESTS_FAILED="TRUE"
#   IngestGranuleSuccessSpec_FAILED="TRUE"
# fi

echo "Waiting for spec/bulkDelete/bulkDeleteSpec.js"
wait "$bulkDeleteSpec_PID"
if [ "$?" -ne "0" ]; then
  TESTS_FAILED="TRUE"
  bulkDeleteSpec_FAILED="TRUE"
fi

echo "Waiting for default"
wait "$default_PID"
if [ "$?" -ne "0" ]; then
  TESTS_FAILED="TRUE"
  default_FAILED="TRUE"
fi

if [ "$TESTS_FAILED" = "TRUE" ]; then
  echo "TESTS FAILED"
  exit 1
else
  echo "TESTS PASSED"
  exit 0
fi
