#!/bin/sh

set -e
# This is meant to be run from the tf-modules/s3-credentials directory as part of the bamboo/create-release.sh script
(cd ../../packages/s3-credentials-endpoint && npm run package)

mkdir -p dist

cp ../../packages/s3-credentials-endpoint/dist/lambda.zip lambda.zip

zip dist/terraform-aws-cumulus-s3-credentials.zip \
  ./*.tf \
  lambda.zip
