#!/bin/bash
# shellcheck disable=SC2154
set -ex

# Bamboo envs are prefixed with bamboo_SECRET to avoid being printed
declare -a param_list=(
  "bamboo_AWS_REGION"
  "bamboo_CMR_PASSWORD"
  "bamboo_CMR_USERNAME"
  "bamboo_DEPLOYMENT"
  "bamboo_FAKE_PROVIDER_CONFIG_BUCKET"
  "bamboo_INTEGRATION_CONCURRENCY"
  "bamboo_METRICS_ES_HOST"
  "bamboo_METRICS_ES_USER"
  "bamboo_NGAP_ENV"
  "bamboo_PDR_NODE_NAME_PROVIDER_BUCKET"
  "bamboo_PUBLISH_FLAG"
  "bamboo_REPORT_BUILD_STATUS"
  "bamboo_SECRET_AWS_ACCESS_KEY_ID"
  "bamboo_SECRET_AWS_ACCOUNT_ID"
  "bamboo_SECRET_AWS_DEFAULT_REGION"
  "bamboo_SECRET_AWS_LAMBDA_SUBNET"
  "bamboo_SECRET_AWS_SECRET_ACCESS_KEY"
  "bamboo_SECRET_AWS_SUBNET"
  "bamboo_SECRET_CSDAP_CLIENT_ID"
  "bamboo_SECRET_CSDAP_CLIENT_PASSWORD"
  "bamboo_SECRET_DOCSEARCH_API_KEY"
  "bamboo_SECRET_DOCSEARCH_INDEX_NAME"
  "bamboo_SECRET_EARTHDATA_CLIENT_ID"
  "bamboo_SECRET_EARTHDATA_CLIENT_PASSWORD"
  "bamboo_SECRET_EARTHDATA_PASSWORD"
  "bamboo_SECRET_EARTHDATA_USERNAME"
  "bamboo_SECRET_GITHUB_TOKEN"
  "bamboo_SECRET_GITHUB_USER"
  "bamboo_SECRET_LAUNCHPAD_PASSPHRASE"
  "bamboo_SECRET_METRICS_ES_PASS"
  "bamboo_SECRET_NPM_TOKEN"
  "bamboo_SECRET_ORCA_DATABASE_USER_PASSWORD"
  "bamboo_SECRET_PROVIDER_FTP_PORT"
  "bamboo_SECRET_PROVIDER_HTTP_PORT"
  "bamboo_SECRET_RDS_ADMIN_ACCESS_SECRET_ARN"
  "bamboo_SECRET_RDS_SECURITY_GROUP"
  "bamboo_SECRET_SECURITY_GROUP"
  "bamboo_SECRET_TOKEN_SECRET"
  "bamboo_SECRET_VPC_CIDR_IP"
  "bamboo_SECRET_VPC_ID"
  "bamboo_SHARED_LOG_DESTINATION_ARN"
  "bamboo_SKIP_AUDIT"
  "bamboo_SKIP_INTEGRATION_TESTS"
  "bamboo_SKIP_NPM_PUBLISH"
  "bamboo_SKIP_CHANGELOG"
  "bamboo_TFSTATE_BUCKET"
  "bamboo_TFSTATE_LOCK_TABLE"
  "bamboo_USE_CACHED_BOOTSTRAP"
  "bamboo_USE_NPM_PACKAGES"
  "bamboo_USE_TERRAFORM_ZIPS"
  "bamboo_VERSION_FLAG"
)

## Strip 'bamboo_SECRET_' from secret keys
## Translate bamboo_ keys to expected stack keys
for key in "${param_list[@]}"; do
  [[ $key =~ bamboo(_SECRET)?_(.*) ]]
  update_key=${BASH_REMATCH[2]}
  export "$update_key"="${!key}"
done

## Get the current git SHA
git config --global --add safe.directory $bamboo.working.directory/source/cumulus
GIT_SHA=$(git rev-parse HEAD)
export GIT_SHA

## Always set GIT_PR true if master branch
if [[ $BRANCH == master ]]; then
  export GIT_PR=true
  echo export GIT_PR=true >> .bamboo_env_vars
fi

## This should take a blank value from the global options, and
## is intended to allow an override for a custom branch build.
if [[ -n $bamboo_GIT_PR ]]; then
  export GIT_PR="$bamboo_GIT_PR"
  export REPORT_BUILD_STATUS=true
  echo export GIT_PR="$GIT_PR" >> .bamboo_env_vars
fi

## Set container IDs for docker-compose stack identification
container_id=${bamboo_planKey,,}
export container_id=${container_id/-/}

# shellcheck disable=SC1091
source .bamboo_env_vars || true

## Branch should be set in the .bamboo_env_vars *or* the
## configured bamboo Environment variables.
if [[ -z $BRANCH ]]; then
  echo "Branch is not set, this is required for Bamboo CI.  Exiting"
  exit 1
fi
echo export BRANCH="$BRANCH" >> .bamboo_env_vars

# Target master by default.
# Update with appropriate conditional
# when creating a feature branch.
export PR_BRANCH='master'

## SKIP CL eval if current branch is equal to the PR branch
if [[ $BRANCH == "$PR_BRANCH" ]]; then
   export SKIP_CHANGELOG=true
   echo export SKIP_CHANGELOG=true >> .bamboo_env_vars
fi

## If tag matching the current ref is a version tag, set
GIT_TAG=$(git describe --exact-match HEAD 2>/dev/null | sed -n '1p')
export GIT_TAG

if [[ $GIT_TAG =~ ^v[0-9]+.* ]]; then
  export VERSION_FLAG=${BASH_REMATCH[0]}
fi

# Timeout is 40 minutes, can be overridden by setting bamboo env variable on build
if [[ -z $TIMEOUT_PERIODS ]]; then
  TIMEOUT_PERIODS=80
fi

## Set environment variable overrides if SIT deployment
if [[ $bamboo_NGAP_ENV = "SIT" ]]; then
  export AWS_ACCESS_KEY_ID=$bamboo_SECRET_SIT_AWS_ACCESS_KEY_ID
  export AWS_SECRET_ACCESS_KEY=$bamboo_SECRET_SIT_AWS_SECRET_ACCESS_KEY
  export AWS_ACCOUNT_ID=$bamboo_SECRET_SIT_AWS_ACCOUNT_ID
  export VPC_ID=$bamboo_SECRET_SIT_VPC_ID
  export AWS_SUBNET=$bamboo_SECRET_SIT_AWS_SUBNET
  export AWS_LAMBDA_SUBNET=$bamboo_SECRET_SIT_AWS_LAMBDA_SUBNET
  export VPC_CIDR_IP=$bamboo_SECRET_SIT_VPC_CIDR_IP
  export FAKE_PROVIDER_CONFIG_BUCKET=$bamboo_SIT_FAKE_PROVIDER_CONFIG_BUCKET
  export PROVIDER_HOST=$bamboo_SECRET_SIT_PROVIDER_HOST
  export SECURITY_GROUP=$bamboo_SECRET_SIT_SECURITY_GROUP
  export TFSTATE_BUCKET=$bamboo_SIT_TFSTATE_BUCKET
  export TFSTATE_LOCK_TABLE=$bamboo_SIT_TFSTATE_LOCK_TABLE
  export SHARED_LOG_DESTINATION_ARN=$bamboo_SIT_SHARED_LOG_DESTINATION_ARN
  export TF_VAR_distribution_url=$bamboo_SIT_TEA_CLOUDFRONT_URL
  export RDS_SECURITY_GROUP=$bamboo_SECRET_SIT_RDS_SECURITY_GROUP
  export RDS_ADMIN_ACCESS_SECRET_ARN=$bamboo_SECRET_SIT_RDS_ADMIN_ACCESS_SECRET_ARN
  export PDR_NODE_NAME_PROVIDER_BUCKET=$bamboo_SIT_PDR_NODE_NAME_PROVIDER_BUCKET
  export ORCA_DATABASE_USER_PASSWORD=$bamboo_SECRET_SIT_ORCA_DATABASE_USER_PASSWORD
  DEPLOYMENT=$bamboo_SIT_DEPLOYMENT
fi


## Run detect-pr script and set flag to true/false
## depending on if there is a PR associated with the
## current ref from the current branch
if [[ -z $GIT_PR ]]; then
  echo "Setting GIT_PR"
  set +e
  node ./bamboo/detect-pr.js "$BRANCH" "$PR_BRANCH"
  PR_CODE=$?
  set -e
  if [[ PR_CODE -eq 100 ]]; then
    export GIT_PR=true
    echo export GIT_PR=true >> .bamboo_env_vars
  elif [[ PR_CODE -eq 0 ]]; then
    export GIT_PR=false
    echo export GIT_PR=false >> .bamboo_env_vars
  else
    echo "Error detecting PR status"
    exit 1
  fi
fi

echo GIT_PR is $GIT_PR

## Exporting the commit message as an env variable to be brought in
## for yes/no toggles on build
if [[ -z $COMMIT_MESSAGE ]]; then
  COMMIT_MESSAGE=$(git log --pretty='format:%Creset%s' -1)
  export COMMIT_MESSAGE
  echo export COMMIT_MESSAGE=\""$COMMIT_MESSAGE"\" >> .bamboo_env_vars
fi

## Set integration stack name if it's not been overridden *or* set by SIT
if [[ -z $DEPLOYMENT ]]; then
  DEPLOYMENT=$(node ./bamboo/select-stack.js)

  echo "Using terraform stack name $DEPLOYMENT-tf"
  DEPLOYMENT=$DEPLOYMENT-tf

  echo deployment "$DEPLOYMENT"
  if [[ $DEPLOYMENT == none ]]; then
    echo "Unable to determine integration stack" >&2
    exit 1
  fi
  echo export DEPLOYMENT="$DEPLOYMENT" >> .bamboo_env_vars
fi

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  export UNIT_TEST_BUILD_DIR=/cumulus
else
  export UNIT_TEST_BUILD_DIR=/uncached/cumulus
fi

export TS_BUILD_CACHE_FILE=ts-build-cache.tgz
