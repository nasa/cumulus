#!/bin/bash
# This script is intented to run following bootstrap_lint_audit.sh
source .bamboo_env_vars || true
if [[ $GIT_PR != true && BRANCH != master ]]; then
  echo >&2 "******Branch HEAD is not a github PR, and this isn't master, skipping bootstrap/deploy step"
  exit 0
fi
npm install
npm run bootstrap-no-build
npm run lint
