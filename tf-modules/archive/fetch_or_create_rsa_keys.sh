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
if ! aws s3api head-object --bucket "$BUCKET" --key "$PRIVATE_KEY"; then
  echo "Uploading private key for ${STACK}"
  openssl genrsa 2048 | \
      aws s3 cp - "s3://${BUCKET}/${PRIVATE_KEY}"
fi

echo "Uploading public key for ${STACK}"
aws s3 cp "s3://${BUCKET}/${PRIVATE_KEY}" - |\
  openssl rsa -outform PEM -pubout |\
  aws s3 cp - "s3://${BUCKET}/${PUBLIC_KEY}"
