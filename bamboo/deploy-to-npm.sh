#!/bin/bash
set -ex
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-publish.sh

if [[ ! $PUBLISH_FLAG == true ]]; then
  >&2 echo "******Skipping publish to npm step as PUBLISH_FLAG is not set"
  exit 0
fi

pip install pipenv
./node_modules/.bin/lerna run prepare
./node_modules/.bin/lerna run package
./node_modules/.bin/lerna run prepublish

VERSION=$(jq --raw-output .version lerna.json)
NPM_TAG=$(node ./bamboo/npm-tag.js);

export VERSION
export NPM_TAG

echo "Publishing packages to NPM with version=${VERSION} and tag=${NPM_TAG}"
export npm_config_unsafe_perm=true

if [[ $SKIP_NPM_PUBLISH != true ]]; then
  ./node_modules/.bin/lerna publish \
    "${VERSION}" \
    --no-git-tag-version \
    --no-push \
    --yes \
    --force-publish=* \
    --dist-tag="${NPM_TAG}" \
    --exact
fi

. ./bamboo/create-release.sh
