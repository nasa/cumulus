# expects CUMULUS_ROOT to be set by parent
set -o pipefail
mkdir -p ${UNIT_TEST_BUILD_DIR}/unit-logs/@cumulus/
touch ${UNIT_TEST_BUILD_DIR}/unit-logs/@cumulus/$(jq -r '.name' package.json).log
npm run test:coverage 2>&1 | tee ${UNIT_TEST_BUILD_DIR}/unit-logs/$(jq -r '.name' package.json).log && \
    rm ${UNIT_TEST_BUILD_DIR}/unit-logs/$(jq -r '.name' package.json).log