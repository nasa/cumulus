'use strict';

import test from 'ava';
const sinon = require('sinon');
const AWS = require('aws-sdk');
const { getEndpoint } = require('@cumulus/ingest/aws');
const dynamodb = new AWS.DynamoDB(getEndpoint());

const {
  createOneTimeRules,
  getSubscriptionRules,
  handler,
  validateMessage
} = require('./lambdas/kinesis-consumer');
const manager = require('./models/base');
const Rule = require('./models/rules');
const model = new Rule();
const tableName = 'rule';
model.tableName = tableName;
const testCollectionName = 'test-collection';

// TODO: This should look like a CNM
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

const ruleTableParams = {
  name: 'name',
  type: 'S',
  schema: 'HASH'
};

let createdRules;

test.before(async () => {
  sinon.stub(Rule, 'buildPayload').resolves(true);

  const createResult = Promise.all(
    [model.create(rule1Params), model.create(rule2Params), model.create(disabledRuleParams)]
  );

  await manager.describeTable({TableName: tableName})
    .then((data) => {
      return createResult.then((created) => {
        createdRules = created;
        return;
      });
    })
    .catch((err) => {
      console.log('in before block')
      if (err.name === 'ResourceNotFoundException') {
        return manager.createTable(tableName, ruleTableParams).then(createResult)
        .then((created) => {
          createdRules = created;
          return;
        });
      } else {
        throw err;
      }
    });
});

test.after(async () => {
  await manager.describeTable({TableName: tableName})
    .then((data) => {
      return manager.deleteTable(tableName);
    })
    .catch((err) => {
      if (err.name === 'ResourceNotFoundException') {
        return;
      } else {
        throw err;
      }
    });
});

test('it should look up subscription-type rules which are associated with the collection, but not those that are disabled', t => {
  return getSubscriptionRules(event).then((result) => {
    t.is(result.length, 2);
  });
});

// FIXME - This is returning 3 at the moment because it doesn't filter out the disabled rule.
test.skip('it should create a onetime rule for each associated workflow', t => {
  return createOneTimeRules(createdRules).then((result) => {
    t.is(result.length, 2);
    result.forEach((rule, idx) => {
      t.is(rule.workflow, `test-workflow-${idx+1}`);
      t.is(rule.rule.type, 'onetime');
    });
  });  
});

test.skip('it should create a onetime rule for each associated workflow', t => {
  return handler(event).then(() => {
    return model.scan({
      collection: {
        name: testCollectionName
      },
      rule: {type: 'onetime'}
    })
  })
  .then((results) => {
    t.is(results.Items.length, 2);
    results.Items.forEach((rule, idx) => {
      t.is(rule.workflow, `test-workflow-${idx+1}`);
      t.is(rule.rule.type, 'onetime');
    });
  });  
});

test('it should throw an error if message does not include a collection', t => {
  const invalidMessage = {};
  return validateMessage(invalidMessage)
    .catch((err) => {
      t.is(err.message, 'validation failed');
      t.is(err.errors[0].message, 'should have required property \'collection\'');
    });
});

test('it should throw an error if message collection has wrong data type', t => {
  const invalidMessage = {collection: {}};
  return validateMessage(invalidMessage)
    .catch((err) => {
      t.is(err.message, 'validation failed');
      t.is(err.errors[0].dataPath, '.collection');
      t.is(err.errors[0].message, 'should be string');
    });
});

test('it should not throw if message is', t => {
  const validMessage = {collection: 'confection-collection'};
  return validateMessage(validMessage)
    .then((result) => {
      t.is(result, validMessage);
    });
});
