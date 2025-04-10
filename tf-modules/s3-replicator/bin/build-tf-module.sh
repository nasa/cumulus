#!/bin/sh

set -e

npm run package

zip dist/terraform-aws-cumulus-s3-replicator.zip \
  *.tf \
  dist/webpack/lambda.zip
