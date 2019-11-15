#!/bin/bash
set -ex

apt-get update
apt-get install -y python-pip
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

# Deploy data-persistence-tf via terraform
echo "Deploying Cumulus data-persistence module to $DEPLOYMENT"
../terraform apply \
  -auto-approve \
  -input=false \
  -var "prefix=$DEPLOYMENT" \
  -var "aws_region=$AWS_REGION" \
  -var "subnet_ids=[\"$AWS_SUBNET\"]"

# Test that deployment succeeded by failing on bad exit code.
EXIT_CODE=$?
if [ $EXIT_CODE -ne  0 ]; then
  exit $EXIT_CODE
fi

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

# Deploy cumulus-tf via terraform
echo "Deploying Cumulus example to $DEPLOYMENT"
../terraform apply \
  -auto-approve \
  -input=false \
  -var-file="../deployments/sandbox.tfvars" \
  -var-file="../deployments/$DEPLOYMENT.tfvars" \
  -var "cumulus_message_adapter_lambda_layer_arn=arn:aws:lambda:us-east-1:$AWS_ACCOUNT_ID:layer:Cumulus_Message_Adapter:9" \
  -var "cmr_username=$CMR_USERNAME" \
  -var "cmr_password=$CMR_PASSWORD" \
  -var "cmr_client_id=cumulus-core-$DEPLOYMENT" \
  -var "cmr_provider=CUMULUS" \
  -var "cmr_environment=UAT" \
  -var "launchpad_passphrase=$LAUNCHPAD_PASSPHRASE" \
  -var "data_persistence_remote_state_config={ region: \"$AWS_REGION\", bucket: \"$TFSTATE_BUCKET\", key: \"$DATA_PERSISTENCE_KEY\" }" \
  -var "region=$AWS_REGION" \
  -var "vpc_id=$VPC_ID" \
  -var "subnet_ids=[\"$AWS_SUBNET\"]" \
  -var "urs_client_id=$EARTHDATA_CLIENT_ID" \
  -var "urs_client_password=$EARTHDATA_CLIENT_PASSWORD" \
  -var "token_secret=$TOKEN_SECRET" \
  -var "permissions_boundary_arn=arn:aws:iam::$AWS_ACCOUNT_ID:policy/NGAPShRoleBoundary"

# Test that deployment succeeded by failing on bad exit code.
EXIT_CODE=$?
if [ $EXIT_CODE -ne  0 ]; then
  exit $EXIT_CODE
fi
