#!/bin/bash
set -e
. ./bamboo/set-bamboo-env-variables.sh
if [[ $GIT_PR != true ]]; then
  >&2 echo "******Branch HEAD is not a github PR, skipping"
  exit 0
fi
(cd example && npm test)