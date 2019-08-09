#!/bin/sh

set -e

rm -rf dist
mkdir dist

zip dist/terraform-aws-cumulus-s3-replicator.zip \
  *.tf \
  *.js
