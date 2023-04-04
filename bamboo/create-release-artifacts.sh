#!/bin/bash

set -ex

## Build TF modules that require source building

(cd tf-modules/distribution && ./bin/build-tf-module.sh && cp ./dist/terraform-aws-cumulus-distribution.zip ../../terraform-aws-cumulus-distribution.zip)
(cd tf-modules/s3-replicator && ./bin/build-tf-module.sh && cp ./dist/terraform-aws-cumulus-s3-replicator.zip ../../terraform-aws-cumulus-s3-replicator.zip)
(cd tf-modules/cumulus-rds-tf && ./bin/build-tf-module.sh && cp ./dist/terraform-aws-cumulus-rds.zip ../../terraform-aws-cumulus-rds.zip)

## Create zipfiles
zip -FS -r -x \*node_modules\* \*internal\* -o terraform-aws-cumulus.zip tf-modules lambdas tasks/**/dist/** packages/**/dist/**
(cd ./tf-modules/workflow; zip -FS -r -x \*node_modules\* -o ../../terraform-aws-cumulus-workflow.zip .)
(cd ./tf-modules/cumulus_ecs_service; zip -FS -r -x \*node_modules\* -o ../../terraform-aws-cumulus-ecs-service.zip .)
