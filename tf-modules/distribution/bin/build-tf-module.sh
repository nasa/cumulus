#!/bin/sh

set -e
# This is meant to be run from the tf-modules/distribution directory as part of the bamboo/create-release.sh script
(cd ../../packages/s3-credentials-endpoint && npm run package)

mkdir -p dist

cp ../../packages/s3-credentials-endpoint/dist/lambda.zip lambda.zip

zip dist/terraform-aws-cumulus-distribution.zip \
  *.tf \
  bucket_map.yaml.tmpl \
  lambda.zip
