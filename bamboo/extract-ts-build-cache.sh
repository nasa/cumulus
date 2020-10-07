#!/bin/bash
set -ex

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  echo "*** Using cached bootstrap build dir"
  cd /cumulus/
fi

tar xvf ts-build-cache.tgz
