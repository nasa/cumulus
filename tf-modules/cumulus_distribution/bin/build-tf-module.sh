#!/bin/sh

set -e
# This is meant to be run from the tf-modules/cumulus_distribution directory as part of the bamboo/create-release.sh script
(cd ../../packages/api && npm run package)

mkdir -p dist

cp ../../packages/api/dist/distribution/lambda.zip lambda.zip

zip dist/terraform-aws-cumulus-distribution.zip \
  *.tf \
  lambda.zip
