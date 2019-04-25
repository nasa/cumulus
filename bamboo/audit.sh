#!/bin/bash
if [[ ! $(git log --pretty='format:%Creset%s' -1) =~ '[skip-audit]' && ! $(git describe --exact-match HEAD 2>/dev/null |sed -n '1p') =~ ^v[0-9]+.* ]];  then
npm install --no-audit;
npm run install-locks;
npm run audit;
fi
