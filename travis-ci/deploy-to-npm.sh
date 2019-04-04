#!/bin/sh

set -e

echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
VERSION=$(jq --raw-output .version lerna.json)
NPM_TAG=$(node ./travis-ci/npm-tag.js);

echo "Publishing packages to NPM with version=${VERSION} and tag=${NPM_TAG}"
lerna publish \
  --skip-git \
  --yes \
  --force-publish=* \
  --npm-tag="$NPM_TAG"
