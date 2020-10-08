#!/bin/bash
set -ex

# . ./bamboo/set-bamboo-env-variables.sh
# . ./bamboo/abort-if-not-pr.sh
# if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
#   echo "*** Using cached bootstrap build dir"
#   cd /cumulus/
# fi

echo "***Extracting build cache of compiled TS code"

tar xvf $TS_BUILD_CACHE_FILE
