#!/bin/sh

set -e

BUCKET="$1"
STACK="$2"

if [ -z "$BUCKET" ] || [ -z "$STACK" ]; then
  echo "Usage: $0 system_bucket stack" >&2
  exit 1
fi

PRIVATE_KEY="${STACK}/crypto/private.pem"
PUBLIC_KEY="${STACK}/crypto/public.pub"

echo "Checking for ${STACK} private key"
# Create private key if it doesn't exist
if ! aws s3api head-object --bucket "$BUCKET" --key "$PRIVATE_KEY" >/dev/null 2>&1; then
  echo "Uploading private key for ${STACK}"
  openssl genrsa -out /dev/stdout 2048 2>/dev/null | aws s3 cp - "s3://${BUCKET}/${PRIVATE_KEY}" >/dev/null 2>&1
fi

echo "Uploading public key for ${STACK}"
aws s3 cp "s3://${BUCKET}/${PRIVATE_KEY}" - 2>/dev/null |\
  openssl rsa -in /dev/stdin -outform PEM -pubout -out /dev/stdout 2>&1 |\
  aws s3 cp - "s3://${BUCKET}/${PUBLIC_KEY}" >/dev/null 2>&1
