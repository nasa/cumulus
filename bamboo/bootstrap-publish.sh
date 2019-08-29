#!/bin/bash
# Required to allow distribution module to build.
# Temporary fix, will be replaced with permanent solution in CUMULUS-1408.
set +e;
apt-get update;
set -e;
apt-get install -y zip
# End temp fix
set -e

. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-publish.sh

npm install -g npm
npm install
rm -rf website/build
npm run docs-install
npm run docs-build
npm run bootstrap-no-build
set +e; apt-get update; set -e;
apt-get install -y jq rsync
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc

git config --global user.name "Bamboo CI"
