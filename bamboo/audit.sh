#!/bin/bash
commit_message_contains_skip_audit=false
commit_is_version_tag=false

if [[ $(git log --pretty='format:%Creset%s' -1) =~ '[skip-audit]' ]]; then
  commit_message_contains_skip_audit=true;
fi
if [[ $(git describe --exact-match HEAD 2>/dev/null |sed -n '1p') =~ ^v[0-9]+.* ]]; then
  commit_is_version_tag=true;
fi

if [[ $commit_message_contains_skip_audit = false && $commit_is_version_tag = false ]]; then
  npm install --no-audit;
  npm run install-locks;
  npm run audit;
fi
