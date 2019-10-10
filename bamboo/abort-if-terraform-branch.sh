#!/bin/bash
set -e

source .bamboo_env_vars || true
if [[ $DEPLOYMENT =~ '-tf'  ]]; then
  >&2 echo "******Integration tests currently disabled on all terraform deployments"
  exit 0
fi
