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
    .then((data) => {
      return data;
    })
    .catch((err) => {
      if (err.name === 'ResourceNotFoundException') {
        console.log('creating table');
        return manager.createTable(tableName, ruleTableParams).then((result) => {
          return result;
        });
      } else {
        throw err;
      }
    });
});

test.after(async t => {
  await manager.describeTable({TableName: tableName})
    .then((data) => {
      console.log('deleting table');
      return manager.deleteTable(tableName).then((result) => {
        return result;
      });
    })
    .catch((err) => {
      if (err.name === 'ResourceNotFoundException') {
        return;
      } else {
        throw err;
      }
    });
});

test('my passing test', async t => {
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

  await manager.describeTable({TableName: tableName})
    .then((result) => {
      console.log(result);
    })
  // return createResult.then((result) => {
  //   return model.get({name: ruleName}).then((isFound) => {
  //     t.is(isFound.name, ruleName);
  //   });
  // });
});

test.todo('it should validate message format');

test.todo('it should look up subscription-type rules which are associated with the collection');

test.todo('it should create a onetime rule per subscription-type rule for each associated workflow');
