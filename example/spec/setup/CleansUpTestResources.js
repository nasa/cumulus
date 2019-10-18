const { aws: { deleteS3Files, listS3ObjectsV2 } } = require('@cumulus/common');
const { loadConfig } = require('../helpers/testUtils');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

describe('Cleans up Test Resources', () => {
  it('removes the test output', async () => {
    const testConfig = await loadConfig();

    const params = {
      Bucket: testConfig.bucket,
      Prefix: `${testConfig.stackName}/test-output/`
    };
    const s3list = await listS3ObjectsV2(params);
    const s3objects = s3list.map((obj) => ({ Bucket: testConfig.bucket, Key: obj.Key }));
    console.log(`\nDeleting ${s3objects.length} objects`);
    await deleteS3Files(s3objects);
  });
});
