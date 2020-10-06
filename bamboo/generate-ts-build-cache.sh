#!/bin/bash
set -ex

PWD=$(pwd)

# Bootstrap to generate the compiled files from TS
npm run bootstrap-no-build

# Get a list of TS compiled files and generate a cache artifact
npm run tsc:listEmittedFiles --silent \
  | grep TSFILE \
  | awk '{print $2}' \
  | sed "s,$PWD/,,g"
  | tar cf ts-build-cache.tgz -T -
