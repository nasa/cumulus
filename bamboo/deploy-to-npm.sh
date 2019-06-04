#!/bin/bash
set -e
. ./bamboo/set-bamboo-env-variables.sh

if [[ $PUBLISH_FLAG == true ]]; then
  export VERSION=$(jq --raw-output .version lerna.json)
  export NPM_TAG=$(node ./bamboo/npm-tag.js);

  echo NPM tag is $NPM_TAG

  echo "Publishing packages to NPM with version=${VERSION} and tag=${NPM_TAG}"
  echo "Would run
  lerna publish \
    ${VERSION} \
    --no-git-tag-version \
    --no-push \
    --yes \
    --force-publish=* \
    --dist-tag=${NPM_TAG} \
    --exact
  "
fi
