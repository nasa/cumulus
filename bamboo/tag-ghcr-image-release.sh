#!/bin/bash
set -ex

. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-publish.sh

IMAGE_NAME="${1:-}"
SOURCE_VERSION=$(echo $bamboo_plan_revision | cut -c1-7)
RELEASE_VERSION=$(jq --raw-output .version lerna.json)

if [[ -z "$IMAGE_NAME" || -z "$SOURCE_VERSION" || -z "$RELEASE_VERSION" ]]; then
  echo "Usage: $0 <image_name>" >&2
  echo "  image_name     - The GHCR image to retag (e.g. ghcr.io/nasa/cumulus-iceberg-api)" >&2
  echo "  SOURCE_VERSION - Derived from bamboo_plan_revision (first 7 chars)" >&2
  echo "  RELEASE_VERSION - Derived from lerna.json version" >&2
  echo "Example: $0 ghcr.io/nasa/cumulus-iceberg-api" >&2
  exit 1
fi

if [[ "$IMAGE_NAME" != ghcr.io/* ]]; then
  echo "Error: image_name must start with ghcr.io/ (received: $IMAGE_NAME)" >&2
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN is required to retag GHCR images." >&2
  exit 1
fi

if [[ -z "${GITHUB_USER:-}" ]]; then
  echo "Error: GITHUB_USER is required for GHCR token exchange." >&2
  exit 1
fi

REPO_PATH="${IMAGE_NAME#ghcr.io/}"
MANIFEST_URL="https://ghcr.io/v2/${REPO_PATH}/manifests"
ACCEPT_MANIFEST="application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"

echo "Tagging GHCR image ${IMAGE_NAME}:${SOURCE_VERSION} as ${IMAGE_NAME}:${RELEASE_VERSION}"

TOKEN_RESPONSE=$(curl --silent --show-error --fail \
  --user "${GITHUB_USER}:${GITHUB_TOKEN}" \
  "https://ghcr.io/token?service=ghcr.io&scope=repository:${REPO_PATH}:pull,push")

BEARER_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // empty')
if [[ -z "$BEARER_TOKEN" ]]; then
  echo "Error: failed to acquire GHCR bearer token." >&2
  exit 1
fi

tmp_manifest=$(mktemp)
tmp_headers=$(mktemp)
cleanup() {
  rm -f "$tmp_manifest" "$tmp_headers"
}
trap cleanup EXIT

GET_STATUS=$(curl --silent --show-error --output "$tmp_manifest" --dump-header "$tmp_headers" \
  --write-out "%{http_code}" \
  --header "Authorization: Bearer ${BEARER_TOKEN}" \
  --header "Accept: ${ACCEPT_MANIFEST}" \
  "${MANIFEST_URL}/${SOURCE_VERSION}")

if [[ "$GET_STATUS" != "200" ]]; then
  echo "Error: failed to fetch source manifest for ${IMAGE_NAME}:${SOURCE_VERSION} (HTTP ${GET_STATUS})." >&2
  exit 1
fi

MANIFEST_CONTENT_TYPE=$(awk 'BEGIN{IGNORECASE=1} /^Content-Type:/ {print $2}' "$tmp_headers" | tr -d '\r' | tail -1)
if [[ -z "$MANIFEST_CONTENT_TYPE" ]]; then
  echo "Error: could not determine source manifest content type." >&2
  exit 1
fi

PUT_STATUS=$(curl --silent --show-error --output /dev/null --write-out "%{http_code}" \
  --request PUT \
  --header "Authorization: Bearer ${BEARER_TOKEN}" \
  --header "Content-Type: ${MANIFEST_CONTENT_TYPE}" \
  --data-binary "@${tmp_manifest}" \
  "${MANIFEST_URL}/${RELEASE_VERSION}")

if [[ "$PUT_STATUS" != "201" ]]; then
  echo "Error: failed to create release tag ${IMAGE_NAME}:${RELEASE_VERSION} (HTTP ${PUT_STATUS})." >&2
  exit 1
fi

echo "Successfully tagged ${IMAGE_NAME}:${SOURCE_VERSION} as ${IMAGE_NAME}:${RELEASE_VERSION}"
