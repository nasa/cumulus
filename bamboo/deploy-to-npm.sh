#!/bin/bash
set -ex
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-publish.sh

export VERSION=$(jq --raw-output .version lerna.json)
export NPM_TAG=$(node ./bamboo/npm-tag.js);

echo "Publishing packages to NPM with version=${VERSION} and tag=${NPM_TAG}"
export npm_config_unsafe_perm=true
npx lerna publish \
  ${VERSION} \
  --no-git-tag-version \
  --no-push \
  --yes \
  --force-publish=* \
  --dist-tag=${NPM_TAG} \
  --exact

. ./bamboo/create-release.sh
