'use strict';

import test from 'ava';

const kinesisConsumer = require('./lambdas/kinesis-consumer');
const manager = require('./models/base');
const models = require('./models');
const model = new models.Rule();
const tableName = 'rule';
model.tableName = tableName;
const ruleName = 'testRule';

const ruleTableParams = {
  name: 'name',
  type: 'S',
  schema: 'HASH'
};

test.before(async t => {
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

test('my passing test', t => {
  const createResult = model.create({
    name: ruleName,
    workflow: 'test-workflow',
    collection: {
      name: 'test-collection',
      version: '0.0.0'
    },
    rule: {
      type: 'scheduled'
    },
    state: 'DISABLED',
  });

  return createResult.then(() => {
    return model.get({name: ruleName}).then((isFound) => {
      t.is(isFound.name, ruleName);
    });
  });
});

test.todo('it should validate message format');

test.todo('it should look up subscription-type rules which are associated with the collection');

test.todo('it should create a onetime rule per subscription-type rule for each associated workflow');
