#!/bin/sh

set -ex

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

# Wait for the stack to be available
KEY="travis-ci-integration-tests/${DEPLOYMENT}.lock"
DATE=$(date -R)
STRING_TO_SIGN_HEAD="HEAD


${DATE}
/${CACHE_BUCKET}/${KEY}"
SIGNATURE=$(/bin/echo -n "$STRING_TO_SIGN_HEAD" | openssl sha1 -hmac "$INTEGRATION_AWS_SECRET_ACCESS_KEY" -binary | base64)

LOCK_EXISTS_STATUS_CODE=$(curl \
  -sS \
  -o /dev/null \
  -w '%{http_code}' \
  --head \
  -H "Host: ${CACHE_BUCKET}.s3.amazonaws.com" \
  -H "Date: ${DATE}" \
  -H "Authorization: AWS ${INTEGRATION_AWS_ACCESS_KEY_ID}:${SIGNATURE}" \
  https://${CACHE_BUCKET}.s3.amazonaws.com/${KEY}
)

while [ "$LOCK_EXISTS_STATUS_CODE" = "200" ]; do
  echo "Another build is using the ${DEPLOYMENT} stack.  Waiting for s3://${CACHE_BUCKET}/${KEY} to not exist."
  sleep 30

  DATE=$(date -R)
  STRING_TO_SIGN_HEAD="HEAD


${DATE}
/${CACHE_BUCKET}/${KEY}"
  SIGNATURE=$(/bin/echo -n "$STRING_TO_SIGN_HEAD" | openssl sha1 -hmac "$INTEGRATION_AWS_SECRET_ACCESS_KEY" -binary | base64)

  LOCK_EXISTS_STATUS_CODE=$(curl \
    -sS \
    -o /dev/null \
    -w '%{http_code}' \
    --head \
    -H "Host: ${CACHE_BUCKET}.s3.amazonaws.com" \
    -H "Date: ${DATE}" \
    -H "Authorization: AWS ${INTEGRATION_AWS_ACCESS_KEY_ID}:${SIGNATURE}" \
    https://${CACHE_BUCKET}.s3.amazonaws.com/${KEY}
  )
done

# Claim the stack
echo "https://travis-ci.org/nasa/cumulus/jobs/${TRAVIS_JOB_ID}" > "${DEPLOYMENT}.lock"
DATE=$(date -R)
STRING_TO_SIGN_PUT="PUT


${DATE}
/${CACHE_BUCKET}/${KEY}"
SIGNATURE=$(/bin/echo -n "$STRING_TO_SIGN_PUT" | openssl sha1 -hmac "$INTEGRATION_AWS_SECRET_ACCESS_KEY" -binary | base64)

curl \
  -sS \
  --fail \
  -X PUT \
  -T "${DEPLOYMENT}.lock" \
  -H "Host: ${CACHE_BUCKET}.s3.amazonaws.com" \
  -H "Date: ${DATE}" \
  -H "Authorization: AWS ${INTEGRATION_AWS_ACCESS_KEY_ID}:${SIGNATURE}" \
  https://${CACHE_BUCKET}.s3.amazonaws.com/${KEY}

rm "${DEPLOYMENT}.lock"

set +e
(
  cd example
  if [ "$USE_NPM_PACKAGES" = "true" ]; then
    yarn
  else
    (cd .. && ./bin/prepare)
  fi

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
RESULT="$?"
set -e

# Delete the stack if it's a nightly build
if ["$DEPLOYMENT" = "nightly"]; then
  ./node_modules/.bin/kes cf delete \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT"

  ./node_modules/.bin/kes cf delete \
    --kes-folder iam \
    --region us-east-1 \
    --deployment "$DEPLOYMENT"

  ./node_modules/.bin/kes lambda S3AccessTest delete \
    --kes-folder app \
    --region us-west-1 \
    --deployment "$DEPLOYMENT"
fi

# Release the stack
DATE=$(date -R)
STRING_TO_SIGN_PUT="DELETE


${DATE}
/${CACHE_BUCKET}/${KEY}"
SIGNATURE=$(/bin/echo -n "$STRING_TO_SIGN_PUT" | openssl sha1 -hmac "$INTEGRATION_AWS_SECRET_ACCESS_KEY" -binary | base64)

curl \
  -sS \
  --fail \
  -X DELETE \
  -H "Host: ${CACHE_BUCKET}.s3.amazonaws.com" \
  -H "Date: ${DATE}" \
  -H "Authorization: AWS ${INTEGRATION_AWS_ACCESS_KEY_ID}:${SIGNATURE}" \
  https://${CACHE_BUCKET}.s3.amazonaws.com/${KEY}

exit "$RESULT"
