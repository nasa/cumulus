#!/bin/bash
set -e

. ./bamboo/set-bamboo-env-variables.sh
if [[ ! -z $DEPLOYMENT ]]; then
  npm install -g npm
  npm install
  rm -rf website/build
  npm run docs-install
  npm run docs-build
  npm run bootstrap-no-build
  apt-get update; apt-get install jq
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
fi
