'use strict';

const test = require('ava');
const sinon = require('sinon');
const AWS = require('aws-sdk');

const { getEndpoint } = require('@cumulus/ingest/aws');
const dynamodb = new AWS.DynamoDB(getEndpoint());

const tableName = 'rule';
process.env.RulesTable = tableName;
const { getSubscriptionRules, handler } = require('../lambdas/kinesis-consumer');
const Rule = require('../models/rules');
const model = new Rule();
const testCollectionName = 'test-collection';

const event = {
  collection: testCollectionName
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

test.before(async () => {
  sinon.stub(Rule, 'buildPayload').resolves(true);
  await Promise.all([rule1Params, rule2Params, disabledRuleParams].map(x => model.create(x)));
});

// getSubscriptionRule tests
test('it should look up subscription-type rules which are associated with the collection, but not those that are disabled', t => {
  return getSubscriptionRules(event).then((result) => {
    t.is(result.length, 2);
  });
});

// handler tests
test('it should create a onetime rule for each associated workflow', t => {
  return handler(event).then(() => {
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
    t.is(results.Items.length, 2);
    const workflowNames = results.Items.map(i => i.workflow).sort();
    t.deepEqual(workflowNames, ['test-workflow-1', 'test-workflow-2']);
    results.Items.forEach(r => t.is(r.rule.type, 'onetime'));
  });  
});

test('it should throw an error if message does not include a collection', t => {
  const invalidMessage = {};
  return handler(invalidMessage)
    .catch((err) => {
      t.is(err.message, 'validation failed');
      t.is(err.errors[0].message, 'should have required property \'collection\'');
    });
});

test('it should throw an error if message collection has wrong data type', t => {
  const invalidMessage = {collection: {}};
  return handler(invalidMessage)
    .catch((err) => {
      t.is(err.message, 'validation failed');
      t.is(err.errors[0].dataPath, '.collection');
      t.is(err.errors[0].message, 'should be string');
    });
});

test('it should not throw if message is valid', t => {
  const validMessage = {collection: 'confection-collection'};
  return handler(validMessage).then(r => t.deepEqual(r, []));
});
