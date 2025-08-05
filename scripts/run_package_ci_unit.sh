set -o pipefail
mkdir -p ${CUMULUS_UNIT_TEST_DATA}/unit-logs/@cumulus/
touch ${CUMULUS_UNIT_TEST_DATA}/unit-logs/$(jq -r '.name' package.json).log
npm run test:coverage 2>&1 | tee ${CUMULUS_UNIT_TEST_DATA}/unit-logs/$(jq -r '.name' package.json).log && \
    rm ${CUMULUS_UNIT_TEST_DATA}/unit-logs/$(jq -r '.name' package.json).log