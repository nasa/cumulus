#!/bin/bash
set -e

if [[ $(git log --pretty='format:%Creset%s' -1) =~ '[skip-unit-tests]' ]]; then
  >&2 echo "*** Skipping unit tests based on commit message: $COMMIT_MESSAGE"
  exit 0
fi
