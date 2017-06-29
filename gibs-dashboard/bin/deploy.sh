#!/bin/bash
# Deploys the GIBS Dashboard

# Causes the script to exit if any command fails with non-zero exit status
set -e

progname=$(basename $0)
docstr="$progname: Builds and deploys GIBS Ops Dashboard via CloudFormation"

usage() {
echo "Usage:
  $progname [--region region] --gibs-stack stack --onearth-stack stack stack_name api_url

Options:
  stack_name            The id to use to identify the cloudformation stack name.
  api_url               The URL of the stack where the gibs Ops API is deployed
  --create              Create a new stack
  --no-stack            Do not install the cloudformation stack. This can avoid failures when there are no
                        changes to the stack other than code to push into s3.
  --no-compile          Do not run npm install or the grunt build
  --region region       Deploy into the given region (default: us-west-2)
  --paas                Stage for the NGAP PaaS but do not deploy
  --gibs-stack stack    The name of the stack containing GIBS ops resources
  --onearth-stack stack The name of the stack containing GIBS on earth resources"
}

function echoerr() {
  echo "Error: $@" 1>&2;
}

operation=update
region=us-west-2
install_stack=true
args=()
paas=false
compile=true

while [[ $# -gt 0 ]]
do
  key="$1"
  if [[ $key == -* ]]; then
    # Dash argument
    case $key in
      --create)
        operation=create
        ;;
      --no-compile)
        compile=false
        ;;
      --no-stack)
        install_stack=false
        ;;
      --paas)
        paas=true
        install_stack=false
        ;;
      --region)
        region="$2"
        shift
        ;;
      --gibs-stack)
        gibs_stack="$2"
        shift
        ;;
      --onearth-stack)
        onearth_stack="$2"
        shift
        ;;
      --help)
        echo "$docstr"
        echo
        usage
        exit 0
        ;;
      *)
        echoerr "Unknown option: $key"
        exit 2
        ;;
    esac
  else
    # Positional argument
    args+=("$key")
  fi
  shift
done

if [ "${#args[@]}" -ne 2 ]; then
  echo "$docstr"
  echo
  usage
  exit 1
fi

if [ -z $gibs_stack ]; then
   echo "--gibs-stack is required"
   echo
   usage
   exit 1
fi

if [ -z $onearth_stack ]; then
   echo "--oneearth-stack is required"
   echo
   usage
   exit 1
fi

stack_name=${args[0]}
api_url=${args[1]}
echo "Deploying stack ${stack_name}" >&2

web_bucket_name="${stack_name}-web"
web_bucket="s3://${web_bucket_name}"

# Get the URL of the API and stick it in the production config.
echo "Using API URL: ${api_url}" >&2

# Generate the production config
cat << EOF > app/scripts/config/production-generated.js
'use strict';

// This is a generated file. Do not manually modify.
module.exports = {
  apiBaseUrl: '${api_url}',
  stackName: '${gibs_stack}',
  onEarthStackName: '${onearth_stack}'
};

EOF

####################################################################################################
# Compilation

if [[ ${compile} == "true" ]]; then
    npm install
    npm run production
fi

####################################################################################################
# Deployment

# Necessary to work around the deploy problem of sending parameters
# See https://github.com/aws/aws-cli/issues/2460
sed "s/\\%WebBucket\\%/${web_bucket_name}/g" config/cloudformation.yml > config/cloudformation-output.yml

if [[ ${install_stack} == "true" ]]; then
    # Figure out what state the stack is in and execute the correct operation
    status=$((aws cloudformation describe-stacks \
                  --region="$region"  \
                  --stack-name "$stack_name" \
                  --output text 2>/dev/null || true) | grep STACKS | awk '{print $NF}')

    # Delete the stack if it is an a create failed state
    if [ "$status" == "CREATE_FAILED" ]; then
        aws cloudformation delete-stack \
          --region="$region"  \
          --stack-name "$stack_name"
        status=
    fi

    operation=update
    if [ -z $status ]; then
        operation=create
    fi

    # Deploy stack
    trace=${-//[^x]/}
    set +e
    if [[ -n "$trace" ]]; then set +x; fi
    out=$((aws cloudformation "${operation}-stack" \
               --region "$region" \
               --stack-name "$stack_name" \
               --template-body "file:///$(pwd)/config/cloudformation-output.yml" \
               --capabilities CAPABILITY_IAM) 2>&1)
    result=$?
    set -e
    if [[ -n "$trace" ]]; then set -x; fi
    if [ $result -ne 0 ]; then
        if [ "$out" != $'\nAn error occurred (ValidationError) when calling the UpdateStack operation: No updates are to be performed.' ]; then
            echo $out
            exit $result
        fi
    else
        aws cloudformation wait "stack-$operation-complete" \
            --region "$region" \
            --stack-name "$stack_name"
    fi
fi
# Test comment

if [[ ${paas} == "false" ]]; then
    # Copy dist to s3 bucket to deploy static web artifacts
    aws s3 cp --acl public-read  --recursive dist/ "$web_bucket"

    site_url=$(aws cloudformation \
                   describe-stacks \
                   --region $region \
                   --stack-name ${stack_name} \
                   --output text | grep OUTPUTS | grep WebsiteURL | awk '{print $NF}')

    echo "Deployed to ${site_url}" >&2
fi
