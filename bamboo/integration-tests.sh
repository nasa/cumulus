#!/bin/bash
set -e

source .bamboo_env_vars || true
if [[ $GIT_PR != true && BRANCH != master ]]; then
  echo "******Branch HEAD is not a github PR or master, skipping step"
  exit 0
fi
. ./bamboo/set-bamboo-env-variables.sh
(cd example && npm test)