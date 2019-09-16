#!/bin/bash
set -ex

echo "Deploying IAM stack to $DEPLOYMENT"
npx kes cf deploy --kes-folder app --region us-east-1\
 --deployment $DEPLOYMENT --template node_modules/@cumulus/deployment/iam

echo "Deploying DB stack to $DEPLOYMENT"
npx kes cf deploy --kes-folder app --region us-east-1\
 --deployment $DEPLOYMENT --template node_modules/@cumulus/deployment/db

echo "Deploying APP stack to $DEPLOYMENT"
npx kes cf deploy --kes-folder app --region us-east-1\
 --deployment $DEPLOYMENT --template node_modules/@cumulus/deployment/app

echo "Deploying S3AccessTest lambda to $DEPLOYMENT"
./node_modules/.bin/kes lambda S3AccessTest deploy \
  --kes-folder app \
  --template node_modules/@cumulus/deployment/app \
  --deployment "$DEPLOYMENT" \
  --region us-west-2
