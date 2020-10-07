#!/bin/bash
set -ex

cp -f ts-build-cache.tgz ./source/cumulus/ts-build-cache.tgz
cp -f ts-build-cache.tgz /cumulus/

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  echo "*** Using cached bootstrap build dir"
  cd /cumulus/
fi

tar xvf ts-build-cache.tgz
