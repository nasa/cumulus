#!/bin/sh

set -evx

echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
VERSION=$(jq --raw-output .version lerna.json)
./node_modules/.bin/lerna publish \
  --skip-git \
  --repo-version "$VERSION" \
  --yes \
  --force-publish=* \
  --npm-client=npm \
  --npm-tag="mth-test-$VERSION"
