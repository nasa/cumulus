#!/bin/bash
set -ex
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh
. ./bamboo/abort-if-not-terraform.sh

npm config set unsafe-perm true
npm install
. ./bamboo/set-bamboo-env-variables.sh

if [[ $USE_NPM_PACKAGES == true ]]; then
  echo "***Deploying stack with NPM packages"
  (cd example && npm install)
else
  echo "***Deploying stack with built packages"
  npm run bootstrap
fi

echo "Locking stack for deployment $DEPLOYMENT"

cd example
set +e

# Fetch terraform binary
if ! curl -o terraform_${TF_VERSION}_linux_amd64.zip https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_amd64.zip ; then
  echo "ERROR: coudn't download terraform script" >&2
  exit 1
else
  unzip -u ./terraform_${TF_VERSION}_linux_amd64.zip
  chmod a+x ./terraform
  rm ./terraform_${TF_VERSION}_linux_amd64.zip
fi

# TODO Necessary in Terraform?
# Wait for the stack to be available
node ./scripts/lock-stack.js true $DEPLOYMENT
LOCK_EXISTS_STATUS=$?
echo "Locking status $LOCK_EXISTS_STATUS"

COUNTER=0
while [[ $LOCK_EXISTS_STATUS == 100 ]]; do
  if [[ $COUNTER -gt $TIMEOUT_PERIODS ]]; then
    echo "Timed out waiting for stack to become available"
    exit 1
  fi
  echo "Another build is using the ${DEPLOYMENT} stack."
  sleep 30
  ((COUNTER++))
  node ./scripts/lock-stack.js true $DEPLOYMENT
  LOCK_EXISTS_STATUS=$?
done
if [[ $LOCK_EXIST_STATUS -gt 0 ]]; then
  exit 1
fi
set -e


for x in $(ls -d *-tf); do
  # Ensure remote state is configured for the deployment
  echo "terraform {
    backend \"s3\" {
      bucket = \"$TFSTATE_BUCKET\"
      key    = \"$DEPLOYMENT/$x/terraform.tfstate\"
      region = \"$AWS_REGION\"
    }
  }" >> ci_backend.tf

  # Initialize deployment
  ./terraform init \
    -input=false

  # Deploy example via terraform
  echo "Deploying Cumulus example to $DEPLOYMENT"
  ./terraform plan \
    -out=terraform.tfplan \
    -input=false \
    -var-file="./deployments/sandbox.tfvars" \
    -var-file="./deployments/$DEPLOYMENT.tfvars" \
    -var "region=$AWS_REGION" \
    -var "vpc_id=$VPC_ID" \
    -var "subnet_ids=[\"$AWS_SUBNET\"]" \
    -var "urs_client_id=$EARTHDATA_CLIENT_ID" \
    -var "urs_client_password=$EARTHDATA_CLIENT_PASSWORD" \
    -var "permissions_boundary_arn=arn:aws:iam::$AWS_ACCOUNT_ID:policy/NGAPShNonProdRoleBoundary"
  ./terraform apply "terraform.tfplan"
  
  # Test that deployment succeded by returning exit code.
  EXIT_CODE = $?
  if [ $EXIT_CODE -ne  0 ]; then
    exit $EXIT_CODE
  fi
done
