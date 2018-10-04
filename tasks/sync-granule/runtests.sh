#!/usr/bin/env bash

result=0
runNumber=0

while [ $result == 0 ]
do
  echo running test run $runNumber
	npm run test
  result=$?
  sleep 5
  ((runNumber++))
done