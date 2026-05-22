set -ex

. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr-or-redeployment.sh
. ./bamboo/abort-if-skip-integration-tests.sh

if [[ "DEPLOY_ICEBERG_REPLICATION" != "true" ]]; then
  echo "Skipping deploy Iceberg replication images step (DEPLOY_ICEBERG_REPLICATION=$DEPLOY_ICEBERG_REPLICATION)" >&2
  exit 0
fi

echo "***Deploying Iceberg replication images"

if ! command -v docker >/dev/null 2>&1; then
  apt-get update && apt-get install -y docker.io
fi

set_iceberg_image_version

./packages/iceberg-replication/build_bootstrap_image.sh $ICEBERG_IMAGE_VERSION
./packages/push_bootstrap_image.sh $ICEBERG_IMAGE_VERSION
./packages/push_kafka_image.sh $DEBEZIUM_VERSION
./packages/push_kafka_connector_image.sh $DEBEZIUM_VERSION
