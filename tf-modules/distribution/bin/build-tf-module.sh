#!/bin/sh

set -e

(cd ../../packages/s3-credentials-endpoint && npm run package)

mkdir -p dist

cp ../../packages/s3-credentials-endpoint/dist/lambda.zip lambda.zip

zip dist/terraform-aws-cumulus-distribution.zip \
  *.tf \
  bucket_map.yaml.tmpl \
  lambda.zip
