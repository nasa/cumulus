#!/bin/sh

set -e

zip dist/terraform-aws-cumulus-distribution.zip \
  *.tf \
  dist/src.zip
