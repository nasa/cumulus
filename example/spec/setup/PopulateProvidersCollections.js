'use strict';

const { addProviders, addCollections } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');
const config = loadConfig();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

const collectionsDirectory = './data/collections';
const providersDirectory = './data/providers';

describe('Populating providers and collections to database', () => {
  let collections;
  let providers;

  it('providers, collections and rules are added successfully', async () => {
    try {
      collections = await addCollections(config.stackName, config.bucket, collectionsDirectory);
      providers = await addProviders(config.stackName, config.bucket, providersDirectory, config.bucket);
    }
    catch (e) {
      console.log(JSON.stringify(e));
      throw e;
    }
    expect(providers).toBeGreaterThanOrEqual(1, 'Number of providers incorrect.');
    expect(collections).toBeGreaterThanOrEqual(1, 'Number of collections incorrect.');
  });
});
