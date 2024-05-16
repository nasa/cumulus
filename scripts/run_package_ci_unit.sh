# expects CUMULUS_ROOT to be set by parent
set -o pipefail
mkdir -p ${UNIT_TEST_BUILD_DIR}/unit-logs/@cumulus/
npm run test:coverage | tee ${UNIT_TEST_BUILD_DIR}/unit-logs/$(jq -r '.name' package.json).log && \
    rm ${UNIT_TEST_BUILD_DIR}/unit-logs/$(jq -r '.name' package.json).log