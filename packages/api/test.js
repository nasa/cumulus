'use strict';

import test from 'ava';
const sinon = require('sinon');

const { createOneTimeRules, getRules, handler } = require('./lambdas/kinesis-consumer');
const manager = require('./models/base');
const models = require('./models');
const Rule = require('./models/rules');
const model = new models.Rule();
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
    return getRules(event).then((result) => {
      t.is(result.length, 1);
    })
  });
});

test('it should not return rules which are disabled', t => {
  const createResult = Promise.all([model.create(rule1Params), model.create(disabledRuleParams)]);

  return createResult.then(() => {
    return getRules(event).then((result) => {
      t.is(result.length, 1);
    })
  });
});

test('it should create a onetime rule for each associated workflow', t => {
  const createResult = Promise.all([model.create(rule1Params), model.create(rule2Params)]);

  return createResult.then((rules) => {
    return createOneTimeRules(rules).then((result) => {
      result.forEach((rule, idx) => {
        t.is(rule.workflow, `test-workflow-${idx+1}`);
        t.is(rule.rule.type, 'onetime');
      });
    });
  });
});

test.todo('it should validate message format');
