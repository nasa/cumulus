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

(cd tf-modules/distribution && ./bin/build-tf-module.sh && cp ./dist/terraform-aws-cumulus-distribution.zip ../../terraform-aws-cumulus-distribution-$VERSION.zip)
(cd tf-modules/s3-replicator && ./bin/build-tf-module.sh && cp ./dist/terraform-aws-cumulus-s3-replicator.zip ../../terraform-aws-cumulus-s3-replicator-$VERSION.zip)

## Create zipfile
zip -r -x \*node_modules\* -o terraform-aws-cumulus-$VERSION.zip tf-modules tasks packages
(cd ./tf-modules/workflow; zip -r -x \*node_modules\* -o ../../terraform-aws-cumulus-workflow-$VERSION.zip .)

### Release package
echo $RELEASE_URL
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus-$VERSION.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-$VERSION.zip
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus-workflow-$VERSION.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-workflow-$VERSION.zip
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus-s3-replicator-$VERSION.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-s3-replicator-$VERSION.zip
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus-distribution-$VERSION.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-distribution-$VERSION.zip
