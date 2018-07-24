'use strict';

const test = require('ava');
const {
  aws: { dynamodb },
  testUtils: { randomString }
} = require('@cumulus/common');
const { AsyncOperation } = require('../../models');

let asyncOperationModel;
test.before(async () => {
  asyncOperationModel = new AsyncOperation({ tableName: randomString() });
  await asyncOperationModel.createTable();
});

test.after.always(() => asyncOperationModel.deleteTable());

test('The AsyncOperation constructor requires that stackName be specified', (t) => {
  try {
    new AsyncOperation({ // eslint-disable-line no-new
      systemBucket: 'asdf',
      tableName: 'asdf'
    });
    t.fail('stackName should be required');
  }
  catch (err) {
    t.is(err instanceof TypeError);
    t.is(err.message, 'stackName is required');
  }
});

test('The AsyncOperation constructor requires that systemBucket be specified', (t) => {
  try {
    new AsyncOperation({ // eslint-disable-line no-new
      stackName: 'asdf',
      tableName: 'asdf'
    });
    t.fail('systemBucket should be required');
  }
  catch (err) {
    t.is(err instanceof TypeError);
    t.is(err.message, 'systemBucket is required');
  }
});

test.todo('The AsyncAdapter.start() method uploads the payload to S3');

test.todo('The AsyncAdapter.start() method starts an ECS task with the correct parameters');

test.todo('The AsyncAdapter.start() method throws an exception if runTask() returned failures');

test.todo('The AsyncAdapter.start() method writes a new record to DynamoDB');

test.todo('The AsyncAdapter.start() method sets the record status to "CREATED"');

test.todo('The AsyncAdapter.start() method returns the newly-generated record');
