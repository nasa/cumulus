#!/bin/bash

AWS_ACCOUNT_ID=$(aws ec2 describe-security-groups \
--group-names 'Default' \
--query 'SecurityGroups[0].OwnerId' \
--output text)

if [ -z "$AWS_DEFAULT_REGION" ]; then
  region="us-east-1"
else
  region=$AWS_DEFAULT_REGION
fi

NAMESPACE="nasa-cumulus"
IMAGE_NAME="provider-gateway"

# -- Build --
echo "Building ..."
./bin/build.sh

# -- Tag --
echo "Tagging ..."
docker tag \
${NAMESPACE}/${IMAGE_NAME}:latest \
${AWS_ACCOUNT_ID}.dkr.ecr.${region}.amazonaws.com/${NAMESPACE}/${IMAGE_NAME}:latest

# -- Login --
echo "Logging in ..."
# Get the login command
login_cmd=$(aws ecr get-login --region ${region} --no-include-email)
# Run the command
$login_cmd

# -- Push --
echo "Pushing ..."
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.${region}.amazonaws.com/${NAMESPACE}/${IMAGE_NAME}:latest

# Remove leftover build stuff so a local repl will still work.
lein clean