#!/bin/bash
set -e

if [[ ! $PUBLISH_FLAG == true ]]; then
  >&2 echo "******Skipping publish step as PUBLISH_FLAG is not set"
  exit 0
fi