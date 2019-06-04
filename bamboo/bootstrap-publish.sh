#!/bin/bash
set -e

. ./bamboo/set-bamboo-env-variables.sh
if [[ $PUBLISH_FLAG == true ]]; then
  npm install -g npm
  npm install
  rm -rf website/build
  npm run docs-install
  npm run docs-build
  npm run bootstrap-no-build
  set +e; apt-get update; set -e;
  apt-get install jq rsync
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
fi
