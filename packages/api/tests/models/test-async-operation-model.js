'use strict';

const cryptoRandomString = require('crypto-random-string');

const test = require('ava');
const sinon = require('sinon');

const { ecs, lambda, s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const { AsyncOperation } = require('../../models');

let asyncOperationModel;
let stubbedEcsRunTaskResult;

let ecsClient;
let systemBucket;

const testDbName = `async_operation_model_test_db_${cryptoRandomString({ length: 10 })}`;

test.before(async () => {
  console.log(testDbName);
  systemBucket = randomString();
  await s3().createBucket({ Bucket: systemBucket }).promise();

  asyncOperationModel = new AsyncOperation({
    systemBucket,
    stackName: randomString(),
    tableName: randomString(),
  });

  await asyncOperationModel.createTable();

  // Set up the mock ECS client
  ecsClient = ecs();
  ecsClient.runTask = (_params) => ({
    promise: () => {
      if (!stubbedEcsRunTaskResult) return Promise.reject(new Error('stubbedEcsRunTaskResult has not yet been set'));
      return Promise.resolve(stubbedEcsRunTaskResult);
    },
  });

  sinon.stub(lambda(), 'getFunctionConfiguration').returns({
    promise: () => Promise.resolve({
      Environment: {
        Variables: {
          ES_HOST: 'es-host',
          AsyncOperationsTable: 'async-operations-table',
        },
      },
    }),
  });
});

test.after.always(async () => {
  sinon.restore();
  await asyncOperationModel.deleteTable();
  await recursivelyDeleteS3Bucket(systemBucket);
});

test('The AsyncOperation constructor requires that stackName be specified', (t) => {
  try {
    new AsyncOperation({
      systemBucket: 'asdf',
      tableName: 'asdf',
    });
    t.fail('stackName should be required');
  } catch (error) {
    t.true(error instanceof TypeError);
    t.is(error.message, 'stackName is required');
  }
});

test('The AsyncOperation constructor requires that systemBucket be specified', (t) => {
  try {
    new AsyncOperation({
      stackName: 'asdf',
      tableName: 'asdf',
    });
    t.fail('systemBucket should be required');
  } catch (error) {
    t.true(error instanceof TypeError);
    t.is(error.message, 'systemBucket is required');
  }
});

test('The AsyncOperation constructor sets the stackName', (t) => {
  const thisTestStackName = randomString();
  const asyncOperation = new AsyncOperation({
    stackName: thisTestStackName,
    systemBucket: randomString(),
    tableName: randomString(),
  });

  t.is(asyncOperation.stackName, thisTestStackName);
});

test('The AsyncOperation constructor sets the systemBucket', (t) => {
  const localAsyncOperationModel = new AsyncOperation({
    stackName: randomString(),
    systemBucket,
    tableName: randomString(),
  });

  t.is(localAsyncOperationModel.systemBucket, systemBucket);
});
