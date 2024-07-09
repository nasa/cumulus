#!/bin/bash
set -ex

NONCACHE_WORKING_DIR=$(pwd)

. ./bamboo/use-working-directory.sh

# We need this installed for the GIT_PR lookup in the env script, but only for this
# first job in the sequence
npm install @octokit/graphql@2.1.1 simple-git@3.7.0

. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh


set -o pipefail

CURRENT_WORKING_DIR=$NONCACHE_WORKING_DIR

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  echo "*** Using cached bootstrap build dir"
  CURRENT_WORKING_DIR=/cumulus
  cd $CURRENT_WORKING_DIR
  git fetch --all
  git checkout "$GIT_SHA"
else
  CURRENT_WORKING_DIR=$(pwd)
fi

npm install

# Bootstrap to install/link packages
npm run ci:bootstrap-no-scripts

# Get a list of TS compiled files
npm run tsc:listEmittedFiles
cat .ts-build-cache-files

# Generate TS build cache artifact
tar cf "$TS_BUILD_CACHE_FILE" -T .ts-build-cache-files
cp "$TS_BUILD_CACHE_FILE" "$NONCACHE_WORKING_DIR"
