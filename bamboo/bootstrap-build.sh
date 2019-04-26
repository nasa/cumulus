#!/bin/bash
if [[ ! -z $CI_UID ]]; then
  groupadd -g $CI_UID bamboo
  useradd --gid bamboo --create-home --uid $CI_UID bamboo
  chown -R bamboo:bamboo /usr/local/lib/node_modules
fi
tail -f /dev/null
