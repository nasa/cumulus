#!/bin/bash
set -ex

# . ./bamboo/set-bamboo-env-variables.sh
if [[ -z $TS_BUILD_CACHE_FILE ]]; then
  echo "Name of TS build cache file cannot be found. Exiting"
  exit 1
fi

echo "***Extracting build cache of compiled TS code"

tar xvf $TS_BUILD_CACHE_FILE
