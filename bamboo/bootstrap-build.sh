#!/bin/bash
if [[ ! -z $CI_UID ]]; then
  groupadd -g $CI_UID bamboo
  useradd --gid bamboo --create-home --uid $CI_UID bamboo
fi
tail -f /dev/null
