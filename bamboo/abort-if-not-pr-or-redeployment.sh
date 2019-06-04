#!/bin/bash
set -e

echo "PWD is $(pwd)"
ls -ltra
printenv
source .bamboo_env_vars || true
echo "Run redeployment is $RUN_REDEPLOYMENT"
if [[ $GIT_PR != true && $RUN_REDEPLOYMENT != true ]]; then
  >&2 echo "******Branch HEAD is not a github PR targeting a protected branch, and this isn't a redeployment build, skipping step"
  exit 0
fi