#!/bin/bash
set -ex

if [[ -z $TS_BUILD_CACHE_FILE ]]; then
  echo "Name of TS build cache file cannot be found. Exiting"
  exit 1
fi

echo "***Extracting build cache of compiled TS code"

tar -xf $TS_BUILD_CACHE_FILE
