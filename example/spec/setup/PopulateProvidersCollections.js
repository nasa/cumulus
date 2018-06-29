
const { addProviders, addCollections, addRules } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');
const config = loadConfig();

config.bucketName = config.bucket; // to add rule

const collectionsDirectory = './data/collections';
const providersDirectory = './data/providers';
const rulesDirectory = './data/rules';

describe('Populating providers, rules and collections to database', () => {
  let collections;
  let providers;
  let rules;
  
  beforeAll(async () => {
    try {
      collections = await addCollections(config.stackName, config.bucket, collectionsDirectory);
      providers = await addProviders(config.stackName, config.bucket, providersDirectory);
      rules = await addRules(config, rulesDirectory);
    }
    catch (e) {
      console.log(e);
      throw e;
    }
  });

  it('providers, rules and collections are added successfully', async () => {
    expect(collections >= 1).toBe(true);
    expect(providers >= 1).toBe(true);
    expect(rules >= 1).toBe(true);
  });
});
