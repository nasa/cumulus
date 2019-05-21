#!/bin/bash
set -e
#source .bamboo_env_vars || true
#. ./bamboo/set-bamboo_env_vars

### Post status to github.  Requires set-bamboo-env-varaibles to have been set.
curl -H\
"Authorization: token $GITHUB_TOKEN"\
 -d "{\"state\":\"$1\", \"target_url\": \"$2\", \"description\": \"$3\", \"context\": \"continuous-integration/earthdata-bamboo\"}"\
 -H "Content-Type: application/json"\
 -X POST\
 https://api.github.com/repos/nasa/cumulus/statuses/b1f82ae267fcb5e9f4fb183e3e5d2a95e42265b6