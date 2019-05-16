#!/bin/bash
# This script runs before lint.sh, audit.sh in the agent container
source .bamboo_env_vars || true
if [[ $GIT_PR != true ]]; then
  >&2 echo "******Branch HEAD is not a github PR, and this isn't a redeployment build, skipping bootstrap/deploy step"
  exit 0
fi
npm install -g npm
ln -s /dev/stdout ./lerna-debug.log
npm install --no-audit
