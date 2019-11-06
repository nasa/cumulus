#!/bin/bash
set -ex
## Create Release
   export RELEASE_URL=$(curl -H\
  "Authorization: token $TOKEN"\
   -d "{\"tag_name\": \"v$VERSION\", \"target_commitsh\": \"v$VERSION\", \"name\": \"v$VERSION\", \"body\": \"Release v$VERSION\" }"\
   -H "Content-Type: application/json"\
   -X POST\
   https://api.github.com/repos/jkovarik/cumulus/releases |grep \"url\" |grep releases |sed -e 's/.*\(https.*\)\"\,/\1/'| sed -e 's/api/uploads/')

## Build TF modules that require source building

(cd tf-modules/distribution && ./bin/build-tf-module.sh && cp ./dist/terraform-aws-cumulus-distribution.zip ../../terraform-aws-cumulus-distribution.zip)
(cd tf-modules/s3-replicator && ./bin/build-tf-module.sh && cp ./dist/terraform-aws-cumulus-s3-replicator.zip ../../terraform-aws-cumulus-s3-replicator.zip)

## Create zipfiles
zip -FS -r -x \*node_modules\* -o terraform-aws-cumulus.zip tf-modules tasks/**/dist/** packages/**/dist/**
(cd ./tf-modules/workflow; zip -FS -r -x \*node_modules\* -o ../../terraform-aws-cumulus-workflow.zip .)
(cd ./tf-modules/cumulus_ecs_service; zip -FS -r -x \*node_modules\* -o ../../terraform-aws-cumulus-ecs-service.zip .)

### Release package
echo $RELEASE_URL
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus.zip
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus-workflow.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-workflow.zip
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus-s3-replicator.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-s3-replicator.zip
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus-distribution.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-distribution.zip
curl -X POST -H "Authorization: token $TOKEN" --data-binary "@terraform-aws-cumulus-ecs-service.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-ecs-service.zip
