#!/bin/bash

set -ex
source .bamboo_env_vars || true
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh

export VERSION=$(jq --raw-output .version lerna.json)

## Create Release
   export RELEASE_URL=$(curl -H\
  "Authorization: token $TOKEN"\
   -d "{\"tag_name\": \"v$VERSION\", \"target_commitsh\": \"v$VERSION\", \"name\": \"v$VERSION\", \"body\": \"Release v$VERSION\" }"\
   -H "Content-Type: application/json"\
   -X POST\
   https://api.github.com/repos/jkovarik/cumulus/releases |grep \"url\" |grep releases |sed -e 's/.*\(https.*\)\"\,/\1/'| sed -e 's/api/uploads/')

## Build TF modules that require source building

$(cd tf-modules/distribution && ./bin/build-tf-module.sh)
$(cd tf-modules/s3-replicator && ./bin/build-tf-module.sh)

## Create zipfile
zip -r -x \*node_modules\* -o terraform-cumulus-$VERSION.zip tf-modules tasks packages

### Release package
echo $RELEASE_URL
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-cumulus-$VERSION.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-cumulus-$VERSION.zip
