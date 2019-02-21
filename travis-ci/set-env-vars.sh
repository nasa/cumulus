#!/bin/sh

# Set the environment variables for a travis build
# based on the NGAP_ENV environment variable

if [ -z $NGAP_ENV ]; then
  NGAP_ENV=SANDBOX
fi

echo Setting variables for environment: $NGAP_ENV

if [ $NGAP_ENV = "SIT" ]; then
  export AWS_ACCESS_KEY_ID="$SIT_AWS_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$SIT_AWS_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="$INTEGRATION_AWS_DEFAULT_REGION"
  export AWS_ACCOUNT_ID="$SIT_AWS_ACCOUNT_ID"
  export VPC_ID="$SIT_VPC_ID"
  export AWS_SUBNET="$SIT_AWS_SUBNET"
  export PROVIDER_HOST="$SIT_PROVIDER_HOST"
else
  export AWS_ACCESS_KEY_ID="$INTEGRATION_AWS_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$INTEGRATION_AWS_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="$INTEGRATION_AWS_DEFAULT_REGION"
  export PROVIDER_HOST="$SANDBOX_PROVIDER_HOST"
fi


if [ -z "$DEPLOYMENT" ]; then
  DEPLOYMENT=$(node ./travis-ci/select-stack.js)
  echo deployment "$DEPLOYMENT"
  if [ "$DEPLOYMENT" = "none" ]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
fi
export DEPLOYMENT