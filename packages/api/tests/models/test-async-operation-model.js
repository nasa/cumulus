'use strict';

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const test = require('ava');
const { promisify } = require('util');

const {
  aws: { dynamodb, s3, s3Join },
  testUtils: { randomString }
} = require('@cumulus/common');
const awsImport = require('@cumulus/common/aws');
const { AsyncOperation } = require('../../models');

let asyncOperationModel;
let configParams;
let awsStub = {};
let ecsStub = {};
let ProxyAsyncOperation;
let runTaskReturn;

const successfulRunTask = {
  tasks: [{ taskArn: 'a-fake-arn' }], failures: []
};
const failureRunTask = {
  tasks: [{ taskArn: 'another-fake-arn' }], failures: [{ error: 'failure', reason: 'meant to fail.' }]
};

const startParams = {
  asyncOperationTaskDefinition: 'aTaskName',
  cluster: 'aCluster',
  lambdaName: 'ALambda',
  payload: { a: 'payload to upload' }
};

test.before(async () => {
  runTaskReturn = successfulRunTask;
  ecsStub = () => ({
    runTask: () => ({
      promise: () => Promise.resolve(runTaskReturn)
    })
  });

  awsStub = { aws: awsImport };
  awsStub.aws.ecs = ecsStub;

  ProxyAsyncOperation = proxyquire('../../models/async-operation.js', { '@cumulus/common/aws': awsStub });

  configParams = {
    tableName: randomString(),
    systemBucket: randomString(),
    stackName: randomString()
  };

  asyncOperationModel = new ProxyAsyncOperation(configParams);
  await asyncOperationModel.createTable();
  await s3().createBucket({ Bucket: configParams.systemBucket }).promise();
});

test.after.always(() => {
  asyncOperationModel.deleteTable();
  s3().deleteBucket({ Bucket: configParams.systemBucket }).promise();
  // do I need to retore test doubles?
});

test('The AsyncOperation constructor requires that stackName be specified', (t) => {
  try {
    new AsyncOperation({ // eslint-disable-line no-new
      systemBucket: 'asdf',
      tableName: 'asdf'
    });
    t.fail('stackName should be required');
  }
  catch (err) {
    t.is(err instanceof TypeError, true);
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
    t.true(err instanceof TypeError);
    t.is(err.message, 'systemBucket is required');
  }
});

test('The AsyncOperation.start() method uploads the payload to S3', async (t) => {
  const asyncOperationRecord = await asyncOperationModel.start(startParams);

  const payloadKey = s3Join(configParams.stackName, 'async-operation-payloads', `${asyncOperationRecord.id}.json`);
  const s3Object = await s3().getObject({ Bucket: configParams.systemBucket, Key: payloadKey }).promise();

  t.deepEqual(JSON.parse(s3Object.Body.toString()), startParams.payload);
});

test.todo('The AsyncOperation.start() method starts an ECS task with the correct parameters');

test('The AsyncOperation.start() method throws an exception if runTask() returned failures', async (t) => {
  runTaskReturn = failureRunTask;
  try {
    await asyncOperationModel.start(startParams);
    t.fail('AsyncOperation.start() with ECS failures should raise error');
  }
  catch (error) {
    t.is(error.message, 'Failed to start AsyncOperation: meant to fail.');
  }
});

test.todo('The AsyncOperation.start() method writes a new record to DynamoDB');

test.todo('The AsyncOperation.start() method sets the record status to "CREATED"');

test.todo('The AsyncOperation.start() method returns the newly-generated record');
