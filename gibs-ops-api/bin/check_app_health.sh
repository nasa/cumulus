#!/bin/bash
# Checks if the deployed application is healthy. Takes the stack name as the first argument.

if [ -z "$1" ] ; then
  echo "Requires stack name as single argument" >&2
  exit 1
fi
stack_name=$1

# Get the exported API URL
api_url=$(aws cloudformation describe-stacks --stack-name "$stack_name" |\
  jq -r '.Stacks[0].Outputs[] | select(.OutputKey == "ApiUrl") | .OutputValue')

start_time=$(date +%s)
elapsed_secs=0

api_response=$(curl --silent -H "Accept: application/json" "${api_url}/health")
while [ "$api_response" != "{\"elasticsearch\":true,\"ok?\":true}" ] ; then
  if [[ $api_response == \{\"elasticsearch* ]]; then
    echo "The API did not respond successfully. response: ${api_response}" >&2
    exit 1
  fi

  curr_time=$(date +%s)
  elapsed_secs=$((curr_time - start_time))
  if [ $elapsed_secs -ge 60 ]; then
    echo "Timed out waiting for stack to become available" >&2
    exit 1
  fi

  echo "Waiting for the API to respond successfully. Response: ${api_response}"
  sleep 10
  api_response=$(curl --silent -H "Accept: application/json" "${api_url}/health")
done

echo "${stack_name} is available at ${api_url}"
