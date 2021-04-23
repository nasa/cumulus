#!/bin/bash

set -ex
source .bamboo_env_vars || true
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh

# Build TF module artifacts
. ./bamboo/create-release-artifacts.sh

export VERSION=$(jq --raw-output .version lerna.json)

# Create Release
export RELEASE_URL=$(curl -H\
  "Authorization: token $GITHUB_TOKEN"\
   -d "{\"tag_name\": \"v$VERSION\", \"target_commitsh\": \"v$VERSION\", \"name\": \"v$VERSION\", \"body\": \"Release v$VERSION\" }"\
   -H "Content-Type: application/json"\
   -X POST\
   https://api.github.com/repos/nasa/cumulus/releases |grep \"url\" |grep releases |sed -e 's/.*\(https.*\)\"\,/\1/'| sed -e 's/api/uploads/')

### Release package
echo $RELEASE_URL
curl -X POST -H "Authorization: token $GITHUB_TOKEN" --data-binary "@terraform-aws-cumulus.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus.zip
curl -X POST -H "Authorization: token $GITHUB_TOKEN" --data-binary "@terraform-aws-cumulus-workflow.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-workflow.zip
curl -X POST -H "Authorization: token $GITHUB_TOKEN" --data-binary "@terraform-aws-cumulus-s3-replicator.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-s3-replicator.zip
curl -X POST -H "Authorization: token $GITHUB_TOKEN" --data-binary "@terraform-aws-cumulus-distribution.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-distribution.zip
curl -X POST -H "Authorization: token $GITHUB_TOKEN" --data-binary "@terraform-aws-cumulus-ecs-service.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-ecs-service.zip
curl -X POST -H "Authorization: token $GITHUB_TOKEN" --data-binary "@terraform-aws-cumulus-rds.zip" -H "Content-type: application/octet-stream" $RELEASE_URL/assets?name=terraform-aws-cumulus-rds.zip
