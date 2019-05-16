#!/bin/bash
# This script is intented to run following bootstrap_lint_audit.sh

. ./bamboo/set-bamboo-env-variables.sh

if [[ $GIT_PR != true ]]; then
  echo "******Branch HEAD is not a github PR, and this isn't a redeployment build, skipping bootstrap/deploy step"
  exit 0
fi
npm install
npm run bootstrap-no-build
npm run lint
