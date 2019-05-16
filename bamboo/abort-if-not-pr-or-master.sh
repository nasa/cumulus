#!/bin/bash
source .bamboo_env_vars || true
if [[ $GIT_PR != true && BRANCH != master ]]; then
  echo "******Branch HEAD is not a github PR, and this isn't a redeployment build, skipping step"
  exit 0
fi
