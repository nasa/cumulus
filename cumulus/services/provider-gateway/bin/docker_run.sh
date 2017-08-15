#!/bin/bash

docker run -d \
--name provider-gateway \
-e AWS_ACCESS_KEY_ID=`aws configure get aws_access_key_id` \
-e AWS_SECRET_ACCESS_KEY=`aws configure get aws_secret_access_key` \
-e AWS_REGION=us-west-2 \
-e AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID} \
-e AWS_DEFAULT_REGION=us-west-2 \
-e STACK_NAME=${STACK_NAME} \
--net="host" \
nasa-cumulus/provider-gateway:latest