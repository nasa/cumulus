#!/bin/bash

set -ex

image="kafka"
original_repo="quay.io/debezium"
ecr_repo="cumulus/debezium"
tag=${1:-3.4}

region=${AWS_DEFAULT_REGION-"us-west-2"}

# pull the original image
docker pull "$original_repo/$image:$tag"

account=$(aws sts get-caller-identity --output text --query 'Account')
# Need to remove \r returned on all aws commands run from Bamboo
account=${account//$'\r'/}

# let this block fail without exiting, so that we can retry with another command if necessary
set +e
login_command=$(aws ecr get-login --no-include-email --region ${region})
login_status=$?
# Need to remove \r returned on all aws commands run from Bamboo
login_command=${login_command//$'\r'/}
$login_command
set -e

# the previous login failed, so try using the updated command
if [ $login_status -ne 0 ]; then
  echo "Trying newer login command."
  login_password=$(aws ecr get-login-password --region ${region})
  login_password=${login_password//$'\r'/}
  docker login --username AWS --password $login_password ${account}.dkr.ecr.${region}.amazonaws.com
fi

docker tag $original_repo/$image:$tag $account.dkr.ecr.$region.amazonaws.com/$ecr_repo/$image:$tag

# Create ECR repo if it doesn't exist
aws ecr describe-repositories --repository-names $ecr_repo/$image || aws ecr create-repository --repository-name $ecr_repo/$image

docker push ${account}.dkr.ecr.${region}.amazonaws.com/$ecr_repo/$image:$tag
