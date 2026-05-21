#!/bin/bash
set -ex

. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh

if [[ $USE_TERRAFORM_ZIPS == true ]]; then
  ## If this flag is set, we want to use the output of the 'publish' stage
  ## to deploy in the integration test stage, so abort
  exit 0;
fi

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  ## Change into cached cumulus, pull down /cumulus ref and run there
  echo "*** Using cached bootstrap"
  cd /cumulus/
  git fetch --all
  git checkout "$GIT_SHA"
fi
echo "***Deploying stack with built source"

# Extract cache of compiled TS files
./bamboo/extract-ts-build-cache.sh

npm install
npm run ci:bootstrap
npm run package

echo "***Bamboo build number: $bamboo_buildNumber"
if [[ $PUBLISH_FLAG == true ]]; then
  ICEBERG_IMAGE_VERSION=$(jq --raw-output .version lerna.json)
else
  ICEBERG_IMAGE_VERSION=${bamboo_buildNumber}
fi

if [[ -z $ICEBERG_IMAGE_VERSION ]]; then
  echo "Error: ICEBERG_IMAGE_VERSION is not set (PUBLISH_FLAG=${PUBLISH_FLAG}). Expected bamboo_buildNumber." >&2
  exit 1
fi
export ICEBERG_IMAGE_VERSION
. ./bamboo/deploy-iceberg-api-image.sh
. ./bamboo/deploy-integration-stack.sh
