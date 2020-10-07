#!/bin/bash
set -ex

NONCACHE_WORKING_DIR=$(pwd)

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  echo "*** Using cached bootstrap build dir"
  cd /cumulus/
  git fetch --all
  git checkout "$GIT_SHA"
else
  npm install
fi

# Bootstrap to generate the compiled files from TS
# npm run bootstrap-no-build

# Debugging
cd packages/checksum
npm run prepare

# Get a list of TS compiled files
npm run tsc:listEmittedFiles --silent | grep TSFILE | awk '{print $2}' | sed "s,$NONCACHE_WORKING_DIR/,,g" >> .ts-build-cache-files
cat .ts-build-cache-files

# Generate TS build cache artifact
tar cf ts-build-cache.tgz -T .ts-build-cache-files

# Debugging - go back to paraent
# cd ../../
# ls -lah .

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  cp ts-build-cache.tgz "$NONCACHE_WORKING_DIR"
fi
