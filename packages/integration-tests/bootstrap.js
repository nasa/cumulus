const { Kinesis } = require('aws-sdk');
const kinesis = new Kinesis({region: 'us-east-1'});

// Setup for sending and receiving a cloud notification message via kinesis
process.env.stackName = 'aimee-deploy-cumulus';
process.env.ProvidersTable = `${process.env.stackName}-ProvidersTable`;
process.env.CollectionsTable = `${process.env.stackName}-CollectionsTable`;
process.env.RulesTable = `${process.env.stackName}-RulesTable`;
process.env.internal = 'cumulus-devseed-internal';
process.env.bucket = process.env.internal;
process.env.kinesisConsumer = `${process.env.stackName}-kinesisConsumer`;
const AWS_ACCOUNT_ID = '433612427488';

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

async function createTestRule(customOpts = {
  providerId,
  collection,
  rule  
}, defaultOpts = {
  name: `${randomString()}_testRule`,
  workflow: 'HelloWorldWorkflow',
  state: 'ENABLED'
}) {
  const allOpts = Object.assign({}, customOpts, defaultOpts);
  return await rule.create(allOpts);
}

const streamName = 'testStream';
async function createStream(opts = {
  ShardCount: 1,
  StreamName: streamName
}) {
  return await kinesis.describeStream({StreamName: opts.StreamName}).promise()
    .then(res => res)
    .catch((err) => {
      if (err.code === 'ResourceNotFoundException') {
        kinesis.createStream(opts).promise();
      }
    });
}

async function putRecord(data, opts = {
  StreamName: streamName,
  PartitionKey: '1'
}) {
  return kinesis.putRecord(Object.assign({}, opts, {Data: data})).promise();
}

let collectionName;
let collectionVersion;
let providerId;
let createdRule;
Promise.all([createTestProvider(), createTestCollection()])
  .then((providerAndCollection) => {
    const provider = providerAndCollection[0];
    const createdCollection = providerAndCollection[1];
    const collectionData = {
      name: createdCollection.name,
      version: createdCollection.version
    };
    collectionName = createdCollection.name;
    collectionVersion = createdCollection.version;
    providerId = provider.id;
    const kinesisRule = {
      type: 'kinesis',
      value: `arn:aws:kinesis:us-east-1:${AWS_ACCOUNT_ID}:stream/${streamName}`
    };
    createTestRule({providerId, collectionData, rule: kinesisRule});
  })
  .then((createRuleResult) => {
    createdRule = createRuleResult;
    const testRecord = { collection: collectionName };
    const stringifiedRecord = JSON.stringify(testRecord);
    putRecord(stringifiedRecord);
  })
  .then(console.log)
  .catch(console.log)
  // .finally(() => {
  //   Promise.all([
  //     collection.delete({name: collectionName, version: collectionVersion}),
  //     provider.delete({id: providerId}),
  //     rule.delete(createdRule);
  //   ]);
  // });
