#!/bin/bash
set -e

source .bamboo_env_vars || true
if [[ $GIT_PR != true ]]; then
  >&2 echo "******Branch HEAD is not a github PR targeting $PR_BRANCH skipping step"
  exit 0
fi
