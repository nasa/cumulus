'use strict';

const test = require('ava');
const sinon = require('sinon');

const tableName = 'rule';
process.env.RulesTable = tableName;
process.env.stackName = 'test-stack';
process.env.bucket = 'test-bucket';
const { getSubscriptionRules, handler } = require('../lambdas/kinesis-consumer');
const manager = require('../models/base');
const Rule = require('../models/rules');
const model = new Rule();
const testCollectionName = 'test-collection';

const ruleTableParams = {
  name: 'name',
  type: 'S',
  schema: 'HASH'
};

const eventData = JSON.stringify({
  collection: testCollectionName
});

const event = {
  Records: [
    {kinesis: {data: new Buffer(eventData).toString('base64')}},
    {kinesis: {data: new Buffer(eventData).toString('base64')}}
  ]
};

const commonRuleParams = {
  collection: {
    name: testCollectionName,
    version: '0.0.0'
  },
  rule: {
    type: 'subscription'
  },
  state: 'ENABLED'
};

const rule1Params = Object.assign({}, commonRuleParams, {
  name: 'testRule1',
  workflow: 'test-workflow-1'
});

const rule2Params = Object.assign({}, commonRuleParams, {
  name: 'testRule2',
  workflow: 'test-workflow-2'
});

const disabledRuleParams = Object.assign({}, commonRuleParams, {
  name: 'disabledRule',
  workflow: 'test-workflow-1',
  state: 'DISABLED'
});

function testCallback(err, object) {
  if (err) throw err;
  return object;
};

test.before(async () => {
  sinon.stub(Rule, 'buildPayload').resolves(true);
  await manager.createTable(tableName, ruleTableParams)
    .then(() => {
      Promise.all([rule1Params, rule2Params, disabledRuleParams].map(x => model.create(x)));
    });
});

test.after.always(async () => {
  await manager.deleteTable(tableName);
});

// getSubscriptionRule tests
// TODO(Aimee): Rewrite test
test.skip('it should look up subscription-type rules which are associated with the collection, but not those that are disabled', t => {
  return getSubscriptionRules(JSON.parse(eventData)).then((result) => {
    t.is(result.length, 2);
  });
});

// handler tests
test('it should create a onetime rule for each associated workflow', async t => {
  await handler(event, {}, testCallback).then(() => {
    return model.scan({
      names: {
        '#col': 'collection',
        '#nm': 'name',
        '#st': 'state',
        '#rl': 'rule',
        '#tp': 'type'
      },
      filter: '#st = :enabledState AND #col.#nm = :collectionName AND #rl.#tp = :ruleType',
      values: {
        ':enabledState': 'ENABLED',
        ':collectionName': testCollectionName,
        ':ruleType': 'onetime'
      }
    });
  })
  .then((results) => {
    t.is(results.Items.length, 4);
    const workflowNames = results.Items.map(i => i.workflow).sort();
    t.deepEqual(workflowNames, [
      'test-workflow-1',
      'test-workflow-1',
      'test-workflow-2',
      'test-workflow-2'
    ]);
    results.Items.forEach(r => t.is(r.rule.type, 'onetime'));
  });  
});

test('it should throw an error if message does not include a collection', t => {
  const invalidMessage = JSON.stringify({});
  const event = {
    Records: [{kinesis: {data: new Buffer(invalidMessage).toString('base64')}}]
  };
  return handler(event, {}, testCallback)
    .catch((err) => {
      const errObject = JSON.parse(err);
      t.is(errObject.errors[0].dataPath, '');
      t.is(errObject.errors[0].message, 'should have required property \'collection\'');
    });
});

test('it should throw an error if message collection has wrong data type', t => {
  const invalidMessage = JSON.stringify({collection: {}});
  const event = {
    Records: [{kinesis: {data: new Buffer(invalidMessage).toString('base64')}}]
  };
  return handler(event, {}, testCallback)
    .catch((err) => {
      const errObject = JSON.parse(err);
      t.is(errObject.errors[0].dataPath, '.collection');
      t.is(errObject.errors[0].message, 'should be string');
    });
});

test('it should not throw if message is valid', t => {
  const validMessage = JSON.stringify({collection: 'confection-collection'});
  const event = {
    Records: [{kinesis: {data: new Buffer(validMessage).toString('base64')}}]
  };
  return handler(event, {}, testCallback).then(r => t.deepEqual(r, []));
});
