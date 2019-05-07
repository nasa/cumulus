#!/bin/bash
set -e

declare -a param_list=(
  "bamboo_SECRET_AWS_ACCESS_KEY_ID"
  "bamboo_SECRET_AWS_SECRET_ACCESS_KEY"
  "bamboo_SECRET_AWS_DEFAULT_REGION"
  "bamboo_SECRET_AWS_ACCOUNT_ID"
  "bamboo_SECRET_VPC_ID"
  "bamboo_SECRET_AWS_SUBNET"
  "bamboo_SECRET_GITHUB_TOKEN"
  "bamboo_SECRET_PROVIDER_HOST"
  "bamboo_SECRET_PROVIDER_HTTP_PORT"
  "bamboo_SECRET_PROVIDER_FTP_PORT"
  "bamboo_SECRET_VPC_CIDR_IP"
  "bamboo_AWS_REGION"
  "bamboo_CMR_PASSWORD"
  "bamboo_CMR_USERNAME"
  "bamboo_SECRET_TOKEN_SECRET"
  "bamboo_SECRET_EARTHDATA_USERNAME"
  "bamboo_SECRET_EARTHDATA_PASSWORD"
  "bamboo_SECRET_EARTHDATA_CLIENT_ID"
  "bamboo_SECRET_EARTHDATA_CLIENT_PASSWORD"
)
regex='bamboo(_SECRET)?_(.*)'

## Strip 'bamboo_SECRET_' from secret keys
## Translate bamboo_ keys to expected
## stack keys
for key in ${param_list[@]}; do
  [[ $key =~ bamboo(_SECRET)?_(.*) ]]
  update_key=${BASH_REMATCH[2]}
  export $update_key=${!key}
done

export COMMIT_MSG=$(git log --pretty='format:%Creset%s' -1)
export GIT_SHA=$(git rev-parse HEAD)

if [[ $(git describe --exact-match HEAD 2>/dev/null |sed -n '1p') =~ ^v[0-9]+.* ]]; then
  export VERSION_TAG=true
fi
echo "Version Tag: $VERSION_TAG"
if [[ -z "$PULL_REQUEST" ]]; then
  export PULL_REQUEST=$(node ./bamboo/detect-pr.js $GIT_SHA)
fi

echo "Pull request: $PULL_REQUEST"

if [ -z "$DEPLOYMENT" ]; then
  DEPLOYMENT=$(node ./bamboo/select-stack.js)
  echo deployment "$DEPLOYMENT"
  if [ "$DEPLOYMENT" = "none" ]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
fi
export DEPLOYMENT