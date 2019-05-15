#!/bin/bash
set -e

# Bamboo envs are prefixed with bamboo_SECRET to avoid being printed
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
## Translate bamboo_ keys to expected stack keys
for key in ${param_list[@]}; do
  [[ $key =~ bamboo(_SECRET)?_(.*) ]]
  update_key=${BASH_REMATCH[2]}
  export $update_key=${!key}
done

export COMMIT_MSG=$(git log --pretty='format:%Creset%s' -1)
export GIT_SHA=$(git rev-parse HEAD)

## This should take a blank value from the global options, and
## is intended to allow an override for a custom branch build.
export GIT_PR=$bamboo_GIT_PR
echo GIT_SHA is $GIT_SHA

source .bamboo_env_vars || true

if [[ -z $GIT_PR ]]; then
  echo "Setting GIT_PR"
  set +e
  node ./bamboo/detect-pr.js $BRANCH
  PR_CODE=$?
  set -e
  if [[ PR_CODE -eq 100 ]]; then
    export GIT_PR=true
    echo GIT_PR=true >> .bamboo_env_vars
  elif [[ PR_CODE -eq 0 ]]; then
    export GIT_PR=false
    echo GIT_PR=false >> .bamboo_env_vars
  else [[ PR_CODE -eq 1 ]]; then
    echo "Error detecting PR status"
    exit 1
  fi
fi

echo GIT_PR is $GIT_PR

if [[ $(git describe --exact-match HEAD 2>/dev/null |sed -n '1p') =~ ^v[0-9]+.* ]]; then
  export VERSION_TAG=true
fi
echo "Version Tag: $VERSION_TAG"

# Timeout is 40 minutes
if [[ -z $TIMEOUT_PERIODS ]]; then
  TIMEOUT_PERIODS=80
fi

if [[ -z $DEPLOYMENT ]]; then
  DEPLOYMENT=$(node ./bamboo/select-stack.js)
  echo deployment "$DEPLOYMENT"
  if [[ $DEPLOYMENT == none ]]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
fi
export DEPLOYMENT


container_id=${bamboo_planKey,,}
export container_id=${container_id/-/}

if [[ $BRANCH == master || $VERSION_TAG || COMMIT_MESSAGE =~ '[run-redeploy-tests]' ]]; then
  export RUN_REDEPLOYMENT=true
fi
