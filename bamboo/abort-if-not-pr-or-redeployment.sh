#!/bin/bash
set -e

source .bamboo_env_vars || true
if [[ $GIT_PR != true && $RUN_REDEPLOYMENT != true ]]; then
  >&2 echo "******Branch HEAD is not a github PR, and this isn't a redeployment build, skipping step"
  exit 0
fi