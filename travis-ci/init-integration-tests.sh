#!/bin/sh

set -e

. ./travis-ci/set-env-vars.sh

if [ "$USE_NPM_PACKAGES" = "true" ]; then
  cd example
  npm ci
else
  # ./bin/prepare
  lerna exec npm run build
  cd example
fi

echo "Locking stack for deployment $DEPLOYMENT"

# Wait for the stack to be available
LOCK_EXISTS_STATUS=$(node ./scripts/lock-stack.js true $DEPLOYMENT)

echo "Locking status $LOCK_EXISTS_STATUS"

while [ "$LOCK_EXISTS_STATUS" = 1 ]; do
  echo "Another build is using the ${DEPLOYMENT} stack."
  sleep 30

  LOCK_EXISTS_STATUS=$(node ./scripts/lock-stack.js true $DEPLOYMENT)
done

(
  ./node_modules/.bin/kes cf deploy \
    --kes-folder iam \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/iam

  ./node_modules/.bin/kes cf deploy \
    --kes-folder app \
    --region us-east-1 \
    --deployment "$DEPLOYMENT" \
    --template node_modules/@cumulus/deployment/app
)

exit
