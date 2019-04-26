#!/bin/bash
set -e
if [[ ! -z $CI_UID ]]; then
  groupadd -g $CI_UID bamboo
  useradd --gid bamboo --create-home --uid $CI_UID bamboo
fi

npm install -g nyc
tail -f /dev/null
