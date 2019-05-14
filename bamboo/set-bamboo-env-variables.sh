#!/bin/bash
set -e

# Bamboo envs are prefixed with bamboo_SECRET to avoid being printed
declare -a param_list=(
  "bamboo_SECRET_AWS_ACCESS_KEY_ID"
  "bamboo_SECRET_AWS_SECRET_ACCESS_KEY"
  "bamboo_SECRET_AWS_DEFAULT_REGION"
  "bamboo_SECRET_AWS_ACCOUNT_ID"
  "bamboo_SECRET_VPC_ID"
  "bamboo_SECRET_AWS_SUBNET"
  "bamboo_SECRET_GITHUB_TOKEN"
  "bamboo_SECRET_PROVIDER_HOST"
  "bamboo_SECRET_PROVIDER_HTTP_PORT"
  "bamboo_SECRET_PROVIDER_FTP_PORT"
  "bamboo_SECRET_VPC_CIDR_IP"
  "bamboo_AWS_REGION"
  "bamboo_CMR_PASSWORD"
  "bamboo_CMR_USERNAME"
  "bamboo_SECRET_TOKEN_SECRET"
  "bamboo_SECRET_EARTHDATA_USERNAME"
  "bamboo_SECRET_EARTHDATA_PASSWORD"
  "bamboo_SECRET_EARTHDATA_CLIENT_ID"
  "bamboo_SECRET_EARTHDATA_CLIENT_PASSWORD"
)
regex='bamboo(_SECRET)?_(.*)'

## Strip 'bamboo_SECRET_' from secret keys
## Translate bamboo_ keys to expected stack keys
for key in ${param_list[@]}; do
  [[ $key =~ bamboo(_SECRET)?_(.*) ]]
  update_key=${BASH_REMATCH[2]}
  export $update_key=${!key}
done

export COMMIT_MSG=$(git log --pretty='format:%Creset%s' -1)
export GIT_SHA=$(git rev-parse HEAD)
echo GIT_SHA is $GIT_SHA

if [[ $(git describe --exact-match HEAD 2>/dev/null |sed -n '1p') =~ ^v[0-9]+.* ]]; then
  export VERSION_TAG=true
fi
echo "Version Tag: $VERSION_TAG"

# Timeout is 40 minutes
if [ -z $TIMEOUT_PERIODS ]; then
  TIMEOUT_PERIODS=80
fi

## Set deployment based on env variables if SIT deploy
if [[ $bamboo_NGAP_ENV = "SIT" ]]; then
  export AWS_ACCESS_KEY_ID=$bamboo_SECRET_SIT_AWS_ACCESS_KEY_ID
  export AWS_SECRET_ACCESS_KEY=$bamboo_SECRET_SIT_AWS_SECRET_ACCESS_KEY
  export AWS_ACCOUNT_ID=$bamboo_SECRET_SIT_AWS_ACCOUNT_ID
  export VPC_ID=$bamboo_SECRET_SIT_VPC_ID
  export AWS_SUBNET=$bamboo_SECRET_SIT_AWS_SUBNET
  export VPC_CIDR_IP=$bamboo_SECRET_SIT_VPC_CIDR_IP
  export PROVIDER_HOST=$bamboo_SECRET_SIT_PROVIDER_HOST
  DEPLOYMENT=$bamboo_SIT_DEPLOYMENT
  echo deployment "$DEPLOYMENT"
fi

## Set integration stack name
if [ -z "$DEPLOYMENT" ]; then
  DEPLOYMENT=$(node ./bamboo/select-stack.js)
  echo deployment "$DEPLOYMENT"
  if [ "$DEPLOYMENT" = "none" ]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
fi
export DEPLOYMENT