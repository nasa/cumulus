#!/bin/bash
set -e

if [[ $BRANCH != master && $PUBLISH_FLAG != true ]]; then
  >&2 echo "******PUBLISH_FLAG or master branch not detected, skipping doc publish"
  exit 0
fi