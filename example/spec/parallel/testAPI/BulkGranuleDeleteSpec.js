const granules = require('@cumulus/api-client/granules');
const { fakeGranuleFactoryV2 } = require('@cumulus/api/lib/testUtils');
const Granule = require('@cumulus/api/models/granules');
const { randomId } = require('@cumulus/common/test-utils');

const {
  loadConfig
} = require('../../helpers/testUtils');

describe('A request to /granules/bulkDelete', () => {
  let config;
  // let granule;

  const execution = randomId('execution');
  process.env.GranulesTable = `${config.stackName}-GranulesTable`;

  beforeAll(async () => {
    config = await loadConfig();

    const granuleModel = new Granule();
    await granuleModel.create(fakeGranuleFactoryV2({
      published: false,
      execution
    }));
  });

  it('should delete granules and their files based on a query');

  it('should fail if any granules cannot be deleted');
});
