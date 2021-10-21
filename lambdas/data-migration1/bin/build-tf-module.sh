#!/bin/sh

set -e
# This is meant to be run from the lambda/data-migrations1 directory as part of the bamboo/create-release.sh script
(npm run package)

mkdir -p tf-module

zip tf-module/terraform-aws-cumulus-data-migrations1.zip \
  *.tf \
  dist/webpack/lambda.zip
