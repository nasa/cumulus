const { loadConfig } = require('../helpers/testUtils');
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
});
