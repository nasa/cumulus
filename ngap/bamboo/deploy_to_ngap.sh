#!/bin/bash

set -e

JQ="docker run -i colstrom/jq"

function getDeploymentState() {
  local DEPLOYMENT_NAME="$1"
  curl \
    --silent \
    --header "Accept: application/json" \
    --header "Authorization: Token token=${bamboo_NGAP_API_PASSWORD}" \
    "${bamboo_NGAP_API}/api/v1/apps/${bamboo_APP_NAME}/deployments/${DEPLOYMENT_NAME}" |\
  $JQ -r .state
}

curl \
  --silent \
  --request POST \
  --header "Accept: application/json" \
  --header "Authorization: Token token=${bamboo_NGAP_API_PASSWORD}" \
  --form "source=@release.tar" \
  --form "comment=${COMMENT}" \
  --output create_deployment_result.json \
  "${bamboo_NGAP_API}/api/v1/apps/${bamboo_APP_NAME}/deployments"

if $JQ -e 'has("error")' < create_deployment_result.json > /dev/null; then
  echo "Failed to create deployment: $(jq -r .error < create_deployment_result.json)"
  exit 1
fi

DEPLOYMENT_ID=$($JQ -r .id < create_deployment_result.json)
DEPLOYMENT_NAME=$($JQ -r .name < create_deployment_result.json)
echo "Created deployment with id=${DEPLOYMENT_ID}, name=${DEPLOYMENT_NAME}"

CHECK_COUNT=240
while [ "$CHECK_COUNT" -gt 0 ]; do
  DEPLOYMENT_STATE=$(getDeploymentState "$DEPLOYMENT_NAME")
  echo "Deployment state: ${DEPLOYMENT_STATE}"

  [ "$DEPLOYMENT_STATE" == "canceled" ] && break
  [ "$DEPLOYMENT_STATE" == "deployed" ] && break
  [ "$DEPLOYMENT_STATE" == "failed" ] && break
  [ "$DEPLOYMENT_STATE" == "obsolete" ] && break
  [ "$DEPLOYMENT_STATE" == "terminated" ] && break

  (( --CHECK_COUNT ))
  sleep 15
done

if [ "$DEPLOYMENT_STATE" == "deployed" ]; then
  echo "Deployment successful."
  exit 0
elif [ "$CHECK_COUNT" -eq 0 ]; then
  echo "Timed out waiting for deployment to complete." >&2
  exit 1
else
  echo "Deployment in unexpected state: ${DEPLOYMENT_STATE}" >&2
  exit 1
fi
