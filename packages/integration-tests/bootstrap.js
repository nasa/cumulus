// Setup for sending and receiving a cloud notification message via kinesis
process.env.stackName = 'aimee-deploy-cumulus';
process.env.ProvidersTable = `${process.env.stackName}-ProvidersTable`;
process.env.CollectionsTable = `${process.env.stackName}-CollectionsTable`;
process.env.RulesTable = `${process.env.stackName}-RulesTable`;
process.env.internal = 'cumulus-devseed-internal';
process.env.bucket = process.env.internal;
process.env.kinesisConsumer = `${process.env.stackName}-kinesisConsumer`;

const { Collection, Provider, Rule } = require('../api/models/');
const provider = new Provider();
const collection = new Collection();
const rule = new Rule();
const { randomString } = require('../common/test-utils');

async function createTestProvider(opts = {
  id: `${randomString()}-testProvider`,
  globalConnectionLimit: 10,
  protocol: 's3',
  host: 'cumulus-data-shared',
  createdAt: new Date().getTime()
}) {
  return await provider.create(opts);
}

async function createTestCollection(opts = {
  name: `${randomString()}-testCollection}`,
  version: '0.0.0',
  granuleId: '^kittens.[\\d]{13}$',
  granuleIdExtraction: '(kittens\\.(.*))\\.hdf',
  sampleFileName: 'kittens.2017034065104.hdf',
  files: []
}) {
  return await collection.create(opts);
}

// provider: 'my-provider',
// collection: {
//   name: 'my-collection-name',
//   version: 'my-collection-version'
// },
// rule: {
//   type: 'kinesis',
//   value: 'my-kinesis-arn'
// },
async function createTestRule(customOpts = {
  provider,
  collection,
  rule  
}, defaultOpts = {
  name: `${randomString()}_testRule`,
  workflow: 'HelloWorldWorkflow',
  state: 'ENABLED'
}) {
  const allOpts = Object.assign({}, customOpts, defaultOpts);
  console.log('opts');
  console.log(allOpts);  
  return await rule.create(allOpts);
}

Promise.all([createTestProvider(), createTestCollection()])
  .then((providerAndCollection) => {
    const providerId = providerAndCollection[0].id;
    const collection = {
      name: providerAndCollection[1].name,
      version: providerAndCollection[1].version
    };
    const kinesisRule = { type: 'kinesis', value: 'arn:aws:kinesis:us-east-1:433612427488:stream/aimee-test-cnm' };
    createTestRule({providerId, collection, rule: kinesisRule})
      .catch(console.log);
  })
  .then(console.log)
  .catch(console.log);
