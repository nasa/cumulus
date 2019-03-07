#!/bin/sh

set -evx

./travis-ci/install-aws-cli.sh

# Determine what cache to use (based on all of the package.json files)
MD5SUM=$(cat $(git ls-files | grep package-lock.json | sort) | md5sum | awk '{print $1}')
CACHE_FILENAME="${MD5SUM}.tar.gz"
KEY="travis-ci-cache/${CACHE_FILENAME}"

echo "Fetching cache from s3://${CACHE_BUCKET}/${KEY}"

# Determine if the cache exists
~/bin/aws s3 ls "s3://${CACHE_BUCKET}/${KEY}" >/dev/null
CACHE_EXISTS_STATUS_CODE="$?"

if [ "$CACHE_EXISTS_STATUS_CODE" -eq "0" ]; then
  # If the cache exists, download it from S3
  echo "Fetching cache"

  ~/bin/aws s3 cp "s3://${CACHE_BUCKET}/${KEY}" | tar -xz
else
  echo "No cache found" >&2
  exit 1
fi
