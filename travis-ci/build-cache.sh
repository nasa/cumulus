#!/bin/sh

set -e

# Determine what cache to use (based on all of the package.json files)
MD5SUM=$(cat $(git ls-files | grep package-lock.json | sort) | md5sum | awk '{print $1}')
CACHE_FILENAME="${MD5SUM}.tar.gz"
KEY="travis-ci-cache/${CACHE_FILENAME}"

# Determine if the cache already exists
DATE=$(date -R)
STRING_TO_SIGN_HEAD="HEAD


${DATE}
/${CACHE_BUCKET}/${KEY}"
SIGNATURE=$(/bin/echo -n "$STRING_TO_SIGN_HEAD" | openssl sha1 -hmac ${CACHE_AWS_SECRET_ACCESS_KEY} -binary | base64)

# CACHE_EXISTS_STATUS_CODE=$(curl \
#   -sS \
#   -o /dev/null \
#   -w '%{http_code}' \
#   --head \
#   -H "Host: ${CACHE_BUCKET}.s3.amazonaws.com" \
#   -H "Date: ${DATE}" \
#   -H "Authorization: AWS ${CACHE_AWS_ACCESS_KEY_ID}:${SIGNATURE}" \
#   https://${CACHE_BUCKET}.s3.amazonaws.com/${KEY}
# )

aws s3 ls "s3://${CACHE_BUCKET}/${KEY}" >/dev/null
CACHE_EXISTS_STATUS_CODE="$?"

if [ "$CACHE_EXISTS_STATUS_CODE" -eq "0" ]; then
# if [ "$CACHE_EXISTS_STATUS_CODE" = "200" ]; then
  # If the cache exists then do nothing
  echo "Cache already exists: s3://${CACHE_BUCKET}/${KEY}"
else
  # If the cache does not exist then create it and upload it to S3
  echo "Creating cache"
  npm ci
  npm run bootstrap-no-build

  for p in $(git ls-files | grep package.json); do
    NODE_MODULES_DIR="$(dirname $p)/node_modules"
    if [ -d "$NODE_MODULES_DIR" ]; then
      tar -rf "${MD5SUM}.tar" "$(dirname $p)/node_modules"
    fi
  done

  gzip "${MD5SUM}.tar"

  CACHE_SIZE=$(du -sh "$CACHE_FILENAME" | awk '{ print $1 }')
  echo "Cache size: $CACHE_SIZE"

  echo "Uploading cache to s3://${CACHE_BUCKET}/${KEY}"
  STRING_TO_SIGN_PUT="PUT


${DATE}
/${CACHE_BUCKET}/${KEY}"
  SIGNATURE=$(/bin/echo -n "$STRING_TO_SIGN_PUT" | openssl sha1 -hmac ${CACHE_AWS_SECRET_ACCESS_KEY} -binary | base64)

  curl \
    -sS \
    -X PUT \
    -T "$CACHE_FILENAME" \
    -H "Host: ${CACHE_BUCKET}.s3.amazonaws.com" \
    -H "Date: ${DATE}" \
    -H "Authorization: AWS ${CACHE_AWS_ACCESS_KEY_ID}:${SIGNATURE}" \
    https://${CACHE_BUCKET}.s3.amazonaws.com/${KEY}
fi
