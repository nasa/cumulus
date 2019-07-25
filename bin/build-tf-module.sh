#!/bin/sh

mkdir -p dist

rm -f dist/terraform-aws-cumulus.zip

zip dist/terraform-aws-cumulus.zip \
  ./*.tf \
  tf-modules/s3-credentials-endpoint/*.tf \
  tf-modules/s3-credentials-endpoint/dist/src.zip
