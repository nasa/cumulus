#!/bin/bash
set -ex

apt-get update
apt-get install -y python3-pip
pip install awscli

TF_VERSION=$(cat .tfversion)
# Fetch terraform binary
if ! curl -o terraform_${TF_VERSION}_linux_amd64.zip https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_amd64.zip ; then
  echo "ERROR: coudn't download terraform script" >&2
  exit 1
else
  unzip -u ./terraform_${TF_VERSION}_linux_amd64.zip
  chmod a+x ./terraform
  rm ./terraform_${TF_VERSION}_linux_amd64.zip
fi

DATA_PERSISTENCE_KEY="$DEPLOYMENT/data-persistence/terraform.tfstate"
cd data-persistence-tf
# Ensure remote state is configured for the deployment
echo "terraform {
  backend \"s3\" {
    bucket = \"$TFSTATE_BUCKET\"
    key    = \"$DATA_PERSISTENCE_KEY\"
    region = \"$AWS_REGION\"
    dynamodb_table = \"$TFSTATE_LOCK_TABLE\"
  }
}" >> ci_backend.tf

# Initialize deployment
../terraform init \
  -input=false

if [[ $NGAP_ENV = "SIT" ]]; then
  BASE_VAR_FILE="sit.tfvars"
  CMA_LAYER_VERSION=19
  ROLE_BOUNDARY=NGAPShRoleBoundary
else
  BASE_VAR_FILE="sandbox.tfvars"
  CMA_LAYER_VERSION=22
  ROLE_BOUNDARY=NGAPShNonProdRoleBoundary
fi

# Deploy data-persistence-tf via terraform
echo "Deploying Cumulus data-persistence module to $DEPLOYMENT"
../terraform apply \
  -auto-approve \
  -input=false \
  -var-file="../deployments/data-persistence/$BASE_VAR_FILE" \
  -var-file="../deployments/data-persistence/$DEPLOYMENT.tfvars" \
  -var "aws_region=$AWS_REGION" \
  -var "subnet_ids=[\"$AWS_SUBNET\"]" \
  -var "vpc_id=$VPC_ID" \
  -var "rds_admin_access_secret_arn=$RDS_ADMIN_ACCESS_SECRET_ARN" \
  -var "rds_security_group=$RDS_SECURITY_GROUP" \
  -var "permissions_boundary_arn=arn:aws:iam::$AWS_ACCOUNT_ID:policy/$ROLE_BOUNDARY"

cd ../cumulus-tf
# Ensure remote state is configured for the deployment
echo "terraform {
  backend \"s3\" {
    bucket = \"$TFSTATE_BUCKET\"
    key    = \"$DEPLOYMENT/cumulus/terraform.tfstate\"
    region = \"$AWS_REGION\"
    dynamodb_table = \"$TFSTATE_LOCK_TABLE\"
  }
}" >> ci_backend.tf

# Initialize deployment
../terraform init \
  -input=false

cd ../..
set_iceberg_image_version
cd example/cumulus-tf

DEPLOY_ICEBERG_API="${DEPLOY_ICEBERG_API:-false}"
ICEBERG_IMAGE_REPOSITORY_URL="${ICEBERG_IMAGE_REPOSITORY_URL:-ghcr.io/nasa/cumulus-iceberg-api}"
ICEBERG_IMAGE_WAIT_TIMEOUT_SECONDS="${ICEBERG_IMAGE_WAIT_TIMEOUT_SECONDS:-1800}"
ICEBERG_IMAGE_WAIT_INTERVAL_SECONDS="${ICEBERG_IMAGE_WAIT_INTERVAL_SECONDS:-15}"

wait_for_ghcr_image() {
  local image_repository_url="$1"
  local image_version="$2"
  local timeout_seconds="$3"
  local interval_seconds="$4"
  local manifest_url="https://ghcr.io/v2/${image_repository_url#ghcr.io/}/manifests/${image_version}"
  local accept_manifest="application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
  local start_time
  local current_time
  local elapsed
  local http_code

  start_time=$(date +%s)
  echo "Waiting up to ${timeout_seconds}s for image ${image_repository_url}:${image_version} to be available in GHCR"

  while true; do
    if [[ -n "$GITHUB_USER" && -n "$GITHUB_TOKEN" ]]; then
      set +x
      http_code=$(curl --silent --show-error --location --output /dev/null --write-out "%{http_code}" \
        --user "$GITHUB_USER:$GITHUB_TOKEN" \
        --header "Accept: ${accept_manifest}" \
        "$manifest_url" || true)
      set -x
    else
      http_code=$(curl --silent --show-error --location --output /dev/null --write-out "%{http_code}" \
        --header "Accept: ${accept_manifest}" \
        "$manifest_url" || true)
    fi

    if [[ "$http_code" == "200" ]]; then
      echo "Image is available in GHCR: ${image_repository_url}:${image_version}"
      return 0
    fi

    current_time=$(date +%s)
    elapsed=$((current_time - start_time))

    if (( elapsed >= timeout_seconds )); then
      echo "Timed out after ${timeout_seconds}s waiting for image ${image_repository_url}:${image_version}. Last HTTP status: ${http_code}" >&2
      return 1
    fi

    echo "Image not available yet (HTTP ${http_code}). Retrying in ${interval_seconds}s..."
    sleep "$interval_seconds"
  done
}

if [[ "$DEPLOY_ICEBERG_API" == "true" && "$ICEBERG_IMAGE_REPOSITORY_URL" == ghcr.io/* ]]; then
  wait_for_ghcr_image \
    "$ICEBERG_IMAGE_REPOSITORY_URL" \
    "$ICEBERG_IMAGE_VERSION" \
    "$ICEBERG_IMAGE_WAIT_TIMEOUT_SECONDS" \
    "$ICEBERG_IMAGE_WAIT_INTERVAL_SECONDS"
fi

echo "Deploy Iceberg API: ${DEPLOY_ICEBERG_API}"
echo "Using Iceberg API image version ${ICEBERG_IMAGE_VERSION}"
echo "Using Iceberg API image repository URL ${ICEBERG_IMAGE_REPOSITORY_URL}"

# Deploy cumulus-tf via terraform
echo "Deploying Cumulus example to $DEPLOYMENT"
../terraform apply \
  -auto-approve \
  -input=false \
  -var-file="../deployments/cumulus/$BASE_VAR_FILE" \
  -var-file="../deployments/cumulus/$DEPLOYMENT.tfvars" \
  -var "cumulus_message_adapter_lambda_layer_version_arn=arn:aws:lambda:us-east-1:$AWS_ACCOUNT_ID:layer:Cumulus_Message_Adapter:$CMA_LAYER_VERSION" \
  -var "cmr_username=$CMR_USERNAME" \
  -var "cmr_password=$CMR_PASSWORD" \
  -var "cmr_client_id=cumulus-core-$DEPLOYMENT" \
  -var "cmr_provider=CUMULUS" \
  -var "cmr_environment=UAT" \
  -var "csdap_client_id=$CSDAP_CLIENT_ID" \
  -var "csdap_client_password=$CSDAP_CLIENT_PASSWORD" \
  -var "launchpad_passphrase=$LAUNCHPAD_PASSPHRASE" \
  -var "data_persistence_remote_state_config={ region: \"$AWS_REGION\", bucket: \"$TFSTATE_BUCKET\", key: \"$DATA_PERSISTENCE_KEY\" }" \
  -var "region=$AWS_REGION" \
  -var "vpc_id=$VPC_ID" \
  -var "lambda_subnet_ids=[$AWS_LAMBDA_SUBNET]" \
  -var "urs_client_id=$EARTHDATA_CLIENT_ID" \
  -var "urs_client_password=$EARTHDATA_CLIENT_PASSWORD" \
  -var "token_secret=$TOKEN_SECRET" \
  -var "permissions_boundary_arn=arn:aws:iam::$AWS_ACCOUNT_ID:policy/$ROLE_BOUNDARY" \
  -var "pdr_node_name_provider_bucket=$PDR_NODE_NAME_PROVIDER_BUCKET" \
  -var "rds_admin_access_secret_arn=$RDS_ADMIN_ACCESS_SECRET_ARN" \
  -var "orca_db_user_password=$ORCA_DATABASE_USER_PASSWORD" \
  -var "metrics_es_host=$METRICS_ES_HOST" \
  -var "metrics_es_username=$METRICS_ES_USER" \
  -var "metrics_es_password=$METRICS_ES_PASS" \
  -var "cumulus_iceberg_api_image_version=$ICEBERG_IMAGE_VERSION" \
  -var "cumulus_iceberg_api_image_repository_url=$ICEBERG_IMAGE_REPOSITORY_URL" \
  -var "deploy_iceberg_api=$DEPLOY_ICEBERG_API"
