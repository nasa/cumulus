#!/bin/bash
set -e

#source .bamboo_env_vars || true
if [[ $COMMIT_MESSAGE =~ skip-terraform ]]; then
  >&2 echo "******Skipping Terraform integration tests based on commit message: $COMMIT_MESSAGE"
  exit 0
fi
