#!/bin/sh

set -e

zip dist/terraform-aws-cumulus-distribution.zip \
  *.tf \
  bucket_map.yaml.tmpl \
  dist/src.zip
