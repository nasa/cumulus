#!/bin/sh

set -e

echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
VERSION=$(jq --raw-output .version lerna.json)
NPM_TAG=$(node ./travis-ci/npm-tag.js);

echo "Publishing packages to NPM with version=${VERSION} and tag=${NPM_TAG}"
lerna publish \
  ${VERSION} \
  --no-git-tag-version \
  --no-push \
  --yes \
  --force-publish=* \
  --dist-tag=${NPM_TAG}
