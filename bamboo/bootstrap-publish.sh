#!/bin/bash
set -e
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-publish.sh

npm install
rm -rf website/build
npm run docs-install
npm run docs-build
npm run bootstrap-no-build
set +e; apt-get update; set -e;
apt-get install -y jq rsync zip
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc

git config --global user.name "Bamboo CI"
