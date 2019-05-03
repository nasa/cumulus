#!/bin/sh

# Set the environment variables for a bamboo build
# based on the NGAP_ENV environment variable

if [ -z $NGAP_ENV ]; then
  NGAP_ENV=SANDBOX
fi

declare -a array=(
  "bamboo_SECRET_AWS_ACCESS_KEY_ID"
  "bamboo_SECRET_AWS_SECRET_ACCESS_KEY"
  "bamboo_SECRET_AWS_DEFAULT_REGION"
  "bamboo_SECRET_AWS_ACCOUNT_ID"
  "$bamboo_SECRET_VPC_ID"
  "$bamboo_SECRET_AWS_SUBNET"
  "$bamboo_SECRET_PROVIDER_HOST"
  "$bamboo_SECRET_PROVIDER_HTTP_PORT"
  "$bamboo_SECRET_PROVIDER_FTP_PORT"
  "$bamboo_SECRET_VPC_CIDR_IP"
  "$bamboo_AWS_REGION"
  "$bamboo_CMR_PASSWORD"
  "$bamboo_CMR_USERNAME"
  "$bamboo_TOKEN_SECRET"
  "bamboo_SECRET_EARTHDATA_USERNAME"
  "bamboo_SECRET_EARTHDATA_PASSWORD"
  "bamboo_SECRET_EARTHDATA_CLIENT_ID"



)

echo Setting variables for environment: $NGAP_ENV

if [ $NGAP_ENV = "SIT" ]; then
  export AWS_ACCESS_KEY_ID="$SIT_AWS_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$SIT_AWS_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="$INTEGRATION_AWS_DEFAULT_REGION"
  export AWS_ACCOUNT_ID="$SIT_AWS_ACCOUNT_ID"
  export VPC_ID="$SIT_VPC_ID"
  export AWS_SUBNET="$SIT_AWS_SUBNET"
  export PROVIDER_HOST="$SIT_PROVIDER_HOST"
  export VPC_CIDR_IP="$SIT_VPC_CIDR_IP"
else
  export AWS_ACCESS_KEY_ID="$bamboo_SECRET_AWS_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$bamboo_SECRET_AWS_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="$bamboo_SECRET_AWS_DEFAULT_REGION"
  export AWS_ACCOUNT_ID="$bamboo_SECRET_AWS_ACCOUNT_ID"
  export VPC_ID="$bamboo_SECRET_VPC_ID"
  export AWS_SUBNET="$bamboo_SECRET_AWS_SUBNET"
  export PROVIDER_HOST="$bamboo_SECRET_PROVIDER_HOST"
  export PROVIDER_HTTP_PORT="$bamboo_SECRET_PROVIDER_HTTP_PORT"
  export PROVIDER_FTP_PORT="$bamboo_SECRET_PROVIDER_FTP_PORT"
  export VPC_CIDR_IP="$bamboo_SECRET_VPC_CIDR_IP"
  export AWS_REGION="$bamboo_AWS_REGION"
  export CMR_PASSWORD="$bamboo_CMR_PASSWORD"
  export CMR_USERNAME="$bamboo_CMR_USERNAME"
  export TOKEN_SECRET="$bamboo_TOKEN_SECRET"
  export EARTHDATA_USERNAME="$bamboo_SECRET_EARTHDATA_USERNAME"
  export EARTHDATA_PASSWORD="$bamboo_SECRET_EARTHDATA_PASSWORD"
  export EARTHDATA_CLIENT_ID="$bamboo_SECRET_EARTHDATA_CLIENT_ID"
  export EARTHDATA_CLIENT_PASSWORD="$bamboo_SECRET_EARTHDATA_CLIENT_PASSWORD"
fi

if [ -z "$DEPLOYMENT" ]; then
  DEPLOYMENT=$(node ./bamboo/select-stack.js)
  echo deployment "$DEPLOYMENT"
  if [ "$DEPLOYMENT" = "none" ]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
fi
export DEPLOYMENT