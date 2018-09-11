# Delete the stack if it's a nightly build
if ["$DEPLOYMENT" = "nightly"]; then
  ./node_modules/.bin/kes cf delete \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT"

  ./node_modules/.bin/kes cf delete \
    --kes-folder iam \
    --region us-east-1 \
    --deployment "$DEPLOYMENT"

  ./node_modules/.bin/kes lambda S3AccessTest delete \
    --kes-folder app \
    --region us-west-1 \
    --deployment "$DEPLOYMENT"
fi

# Release the stack
DATE=$(date -R)
STRING_TO_SIGN_PUT="DELETE


${DATE}
/${CACHE_BUCKET}/${KEY}"
SIGNATURE=$(/bin/echo -n "$STRING_TO_SIGN_PUT" | openssl sha1 -hmac "$INTEGRATION_AWS_SECRET_ACCESS_KEY" -binary | base64)

curl \
  -sS \
  --fail \
  -X DELETE \
  -H "Host: ${CACHE_BUCKET}.s3.amazonaws.com" \
  -H "Date: ${DATE}" \
  -H "Authorization: AWS ${INTEGRATION_AWS_ACCESS_KEY_ID}:${SIGNATURE}" \
  https://${CACHE_BUCKET}.s3.amazonaws.com/${KEY}

exit 0