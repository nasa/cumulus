#!/bin/bash
set -e
. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-publish.sh

# Extract cache of compiled TS files
./bamboo/extract-ts-build-cache.sh

npm install
rm -rf website/build
npm run docs-install
npm run docs-build
npm run ci:bootstrap-no-scripts
set +e; apt-get update; set -e;
apt-get install -y jq rsync zip
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc

git config --global user.name "Bamboo CI"
git config --global user.email "cumulus.bot@gmail.com"