'use strict';

import test from 'ava';
const sinon = require('sinon');

const {
  createOneTimeRules,
  getRules,
  handler,
  validateMessage
} = require('./lambdas/kinesis-consumer');
const manager = require('./models/base');
const Rule = require('./models/rules');
const model = new Rule();
const tableName = 'rule';
model.tableName = tableName;
const ruleName = 'testRule';
const testCollectionName = 'test-collection';

// TODO: This should look like a CNM
const event = {
  collection: testCollectionName
};

const commonRuleParams = {
  name: ruleName,
  collection: {
    name: testCollectionName,
    version: '0.0.0'
  },
  rule: {
    type: 'subscription'
  },
  state: 'ENABLED',
};

const rule1Params = Object.assign({}, commonRuleParams, {workflow: 'test-workflow-1'});
const rule2Params = Object.assign({}, commonRuleParams, {workflow: 'test-workflow-2'});
const disabledRuleParams = Object.assign({}, commonRuleParams, {
  workflow: 'test-workflow-1',
  state: 'DISABLED'
});

test.before(async t => {
  sinon.stub(Rule, 'buildPayload').resolves(true);

  const ruleTableParams = {
    name: 'name',
    type: 'S',
    schema: 'HASH'
  };

  await manager.describeTable({TableName: tableName})
    .catch((err) => {
      if (err.name === 'ResourceNotFoundException') {
        return manager.createTable(tableName, ruleTableParams);
      } else {
        throw err;
      }
    });
});

test.after(async t => {
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

test('it should look up subscription-type rules which are associated with the collection', t => {
  const createResult = model.create(rule1Params);

  return createResult.then(() => {
    return getRules(event)
  }).then((result) => {
    t.is(result.length, 1);
  });
});

test('it should not return rules which are disabled', t => {
  const createResult = Promise.all([model.create(rule1Params), model.create(disabledRuleParams)]);

  return createResult.then(() => {
    return getRules(event)
  }).then((result) => {
    t.is(result.length, 1);
  });
});

test('it should create a onetime rule for each associated workflow', t => {
  const createResult = Promise.all([model.create(rule1Params), model.create(rule2Params)]);

  return createResult.then((rules) => {
    return createOneTimeRules(rules)
  }).then((result) => {
    result.forEach((rule, idx) => {
      t.is(rule.workflow, `test-workflow-${idx+1}`);
      t.is(rule.rule.type, 'onetime');
    });
  });
});

// test('it should create a onetime rule for each associated workflow', t => {
//   const createResult = Promise.all([model.create(rule1Params), model.create(rule2Params)]);

//   return createResult.then((rules) => {
//     return handler(event).then(() => {
//       return model.scan({
//         collection: {
//           name: testCollectionName
//         },
//         rule: {type: 'onetime'}
//       })
//       .then((results) => {
//         t.is(results.Items.length, 2);
//         results.Items.forEach((rule, idx) => {
//           t.is(rule.workflow, `test-workflow-${idx+1}`);
//           t.is(rule.rule.type, 'onetime');
//         });
//       })
//     });
//   });
// });

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
