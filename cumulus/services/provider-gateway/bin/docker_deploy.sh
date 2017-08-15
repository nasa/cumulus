#!/bin/bash

AWS_ACCOUNT_ID=$(aws ec2 describe-security-groups \
--group-names 'Default' \
--query 'SecurityGroups[0].OwnerId' \
--output text)

IMAGE_NAME="provider-gateway"
NAMESPACE="nasa-cumulus"


# -- Build --
echo "Building ..."
./bin/build.sh

# -- Tag --
echo "Tagging ..."
docker tag ${NAMESPACE}/${IMAGE_NAME}:latest ${AWS_ACCOUNT_ID}.dkr.ecr.us-west-2.amazonaws.com/${NAMESPACE}/${IMAGE_NAME}:latest

# -- Login --
echo "Logging in ..."
# Get the login command
login_cmd=$(aws ecr get-login --region us-west-2 --no-include-email)
# Run the command
$login_cmd

# -- Push --
echo "Pushing ..."
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.us-west-2.amazonaws.com/${NAMESPACE}/${IMAGE_NAME}:latest