#!/bin/sh

# Open a tunnel to an Elasticsearch instance running in AWS

set -e

ENV="$1"
if [ -z "$ENV" ]; then
  echo "Usage: $0 ENV" >&2
  exit 1
fi

KEY_PATH="$2"
if [ -z "$KEY_PATH" ]; then
  echo "Usage: $0 $1 KEY_PATH" >&2
  exit 1
fi

INSTANCES=$(
  aws ec2 describe-instances \
    --filters "Name=tag:Deployment,Values=${ENV}" \
    "Name=instance-state-name,Values=running"
)

INSTANCE_ID=$(echo "$INSTANCES" | jq -r '.Reservations[0].Instances[0].InstanceId')

if [ "$INSTANCE_ID" = "null" ]; then
  echo "Unable to determine EC2 instance for tunnel" >&2
  exit 1
fi

DOMAIN=$(aws opensearch describe-domain --domain-name "${ENV}-es-vpc")
DOMAIN_HOSTNAME=$(echo "$DOMAIN" | jq -r .DomainStatus.Endpoints.vpc)

ssh -L "8443:${DOMAIN_HOSTNAME}:443" "$INSTANCE_ID" "-i" "$KEY_PATH"
