#!/bin/bash
set -ex
. ./bamboo/abort-if-not-terraform.sh

DATA_PERSISTENCE_KEY="$DEPLOYMENT/data-persistence/terraform.tfstate"

cd data-persistence-tf
# Ensure remote state is configured for the deployment
echo "terraform {
  backend \"s3\" {
    bucket = \"$TFSTATE_BUCKET\"
    key    = \"$DATA_PERSISTENCE_KEY\"
    region = \"$AWS_REGION\"
  }
}" >> ci_backend.tf

# Initialize deployment
../terraform init \
  -input=false

# Deploy data-persistence-tf via terraform
echo "Deploying Cumulus data-persistence module to $DEPLOYMENT"
../terraform plan \
  -out=terraform.tfplan \
  -input=false \
  -var "prefix=$DEPLOYMENT" \
  -var "aws_region=$AWS_REGION" \
  -var "subnet_ids=[\"$AWS_SUBNET\"]"
../terraform apply "terraform.tfplan"
