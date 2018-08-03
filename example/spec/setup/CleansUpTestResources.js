const { loadConfig } = require('../helpers/testUtils');
const { aws: { deleteS3Files, listS3ObjectsV2, s3 } } = require('@cumulus/common');
const { deleteRules, rulesList } = require('@cumulus/integration-tests');
const testConfig = loadConfig();
const ruleDirectory = './data/rules';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

describe('Cleans up Test Resources', () => {
  it('removes the PODAAC_SWOT rule', async () => {
    const rules = await rulesList(testConfig.stackName, testConfig.bucket, ruleDirectory);
    const deleted = await deleteRules(testConfig.stackName, testConfig.bucket, rules); //
    expect(deleted).toBeGreaterThanOrEqual(1);
  });

  it('removes the test output', async () => {
    const params = {
      Bucket: testConfig.bucket,
      Prefix: `${testConfig.stackName}/test-output/`
    };
    const s3list = await listS3ObjectsV2(params);
    const s3objects = s3list.map((obj) => ({ Bucket: testConfig.bucket, Key: obj.Key }));
    await deleteS3Files(s3objects);
  });
});
