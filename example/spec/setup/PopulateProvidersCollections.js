
const { addProviders, addCollections } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');
const config = loadConfig();

const collectionsDirectory = './data/collections';
const providersDirectory = './data/providers';

describe('Populating providers and collections to database', () => {
  let collections;
  let providers;
  beforeAll(async () => {
    try {
      collections = await addCollections(config.stackName, config.bucket, collectionsDirectory);
      providers = await addProviders(config.stackName, config.bucket, providersDirectory);
    }
    catch (e) {
      console.log(e);
      throw e;
    }
  });

  it('providers and collections are added successfully', async () => {
    expect(collections >= 1).toBe(true);
    expect(providers >= 1).toBe(true);
  });
});
