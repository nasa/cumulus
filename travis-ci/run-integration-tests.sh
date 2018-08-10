#!/bin/sh

set -evx

export AWS_ACCESS_KEY_ID="$INTEGRATION_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$INTEGRATION_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$INTEGRATION_AWS_DEFAULT_REGION"

if [ -z "$DEPLOYMENT" ]; then
  DEPLOYMENT=$(node ./travis-ci/select-stack.js)
  if [ "$DEPLOYMENT" = "none" ]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
fi
export DEPLOYMENT

./bin/prepare

(
  cd example

  ./node_modules/.bin/kes cf deploy \
    --kes-folder iam \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/iam

  ./node_modules/.bin/kes cf deploy \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/app

  ./node_modules/.bin/kes lambda S3AccessTest deploy \
    --kes-folder app \
    --region us-west-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/app

  yarn test
)
