const elasticsearchApi = require('@cumulus/api-client/elasticsearch');

const { randomId } = require('@cumulus/common/test-utils');

const { loadConfig } = require('../../helpers/testUtils');

let testConfig;
let prefix;
let indexName;

describe('Elasticsearch endpoint', () => {
  describe('Index From Database ', () => {
    beforeAll(async () => {
      testConfig = await loadConfig();
      prefix = testConfig.stackName;
      indexName = randomId('estestindex').toLocaleLowerCase();
    });
    afterAll(async () => {
      // delete index? how do we clean up
    });
    it('Starts the asyncOperation without error.', async () => {
      const body = { indexName };
      const response = await elasticsearchApi.indexFromDatabase({
        prefix,
        body,
      });
      expect(response.statusCode).toBe(200);
      const returnedObject = JSON.parse(response.body);

      expect(returnedObject.message).toContain(
        `Indexing database to ${indexName}`
      );
      console.log(JSON.stringify(response));
    });
  });
});
