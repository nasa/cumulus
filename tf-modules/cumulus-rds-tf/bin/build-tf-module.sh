#!/bin/sh

set -e
# This is meant to be run from the tf-modules/cumulus-rds-tf directory as part of the bamboo/create-release.sh script
(cd ../../lambdas/db-provision-user-database && npm run package)

mkdir -p dist

zip dist/terraform-aws-cumulus-rds.zip \
  *.tf \
  db-provision-user-database/*.tf \
  db-provision-user-database/dist/webpack/lambda.zip
