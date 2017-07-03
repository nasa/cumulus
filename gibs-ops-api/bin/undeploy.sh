#!/bin/bash
# Un-Deploys the GIBS API

# Causes the script to exit if any command fails with non-zero exit status
set -e

progname=$(basename $0)
docstr="$progname: Removes the GIBS API stack"

usage() {
echo "Usage:
  $progname id

Options:
  id              The id to use to identify the cloudformation template

Examples:
  $progname xx-gibs-api"
}

function echoerr() {
  echo "Error: $@" 1>&2;
}

args=()

while [[ $# -gt 0 ]]
do
  key="$1"
  if [[ $key == -* ]]; then
    # Dash argument
    case $key in
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

if [ "${#args[@]}" -ne 1 ]; then
  echo "$docstr"
  echo
  usage
  exit 1
fi

stack_name=${args[0]}
deploy_bucket_name="${stack_name}"
deploy_bucket="s3://${deploy_bucket_name}"

# Destroy the stack
aws cloudformation delete-stack --stack-name "${stack_name}"
aws cloudformation wait stack-delete-complete --stack-name "${stack_name}"

# Delete everything from the deployment bucket
aws s3 rm --recursive "${deploy_bucket}"
aws s3 rb "${deploy_bucket}"
