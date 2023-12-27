'use strict';

const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const kinesisUtils = require('@cumulus/aws-client/Kinesis');
const awsServices = require('@cumulus/aws-client/services');
const log = require('@cumulus/common/log');

const messageConsumer = require('../../lambdas/message-consumer');
const manualConsumer = rewire('../../lambdas/manual-consumer');

const Kinesis = awsServices.kinesis();
let describeStreamStub;
const fakeStackName = 'fake-stack';
const rulesArray = [];

test.before(() => {
  describeStreamStub = sinon.stub(kinesisUtils, 'describeStream').callsFake(() => Promise.resolve({
    StreamDescription: {
      StreamARN: 'fake-stream-arn',
    },
  }));
});

test.after.always(() => {
  describeStreamStub.restore();
});

test.serial('configureTimestampEnvs throws error when invalid endTimestamp is provided', (t) => {
  const event = {
    endTimestamp: Date.now().toString(),
  };
  t.throws(
    () => manualConsumer.configureTimestampEnvs(event),
    { message: `endTimestamp ${event.endTimestamp} is not a valid input for new Date().` }
  );
  delete process.env.endTimestamp;
});

test.serial('configureTimestampEnvs throws error when invalid startTimestamp is provided', (t) => {
  const event = {
    startTimestamp: Date.now().toString(),
  };
  t.throws(
    () => manualConsumer.configureTimestampEnvs(event),
    { message: `startTimestamp ${event.startTimestamp} is not a valid input for new Date().` }
  );
  delete process.env.endTimestamp;
});

test('setupIteratorParams returns TRIM_HORIZON iterator params if timestamp env is not set', (t) => {
  const stream = 'stream-1234';
  const shardId = 'shard-1234';
  const expectedParams = {
    StreamName: stream,
    ShardId: shardId,
    ShardIteratorType: 'TRIM_HORIZON',
  };
  const actualParams = manualConsumer.setupIteratorParams(stream, shardId);
  t.deepEqual(expectedParams, actualParams);
});

test.serial('setupIteratorParams returns AT_TIMESTAMP iterator params if timestamp env is set', (t) => {
  process.env.startTimestamp = '1969-12-31T16:00:00.000Z';
  const stream = 'stream-1234';
  const shardId = 'shard-1234';
  const expectedParams = {
    StreamName: stream,
    ShardId: shardId,
    ShardIteratorType: 'AT_TIMESTAMP',
    Timestamp: process.env.startTimestamp,
  };
  const actualParams = manualConsumer.setupIteratorParams(stream, shardId);
  delete process.env.startTimestamp;
  t.deepEqual(expectedParams, actualParams);
});

test('setupListShardParams returns params with no StreamCreationTimestamp if it is omitted', (t) => {
  const stream = 'stream-1234';
  const expectedParams = {
    StreamName: stream,
  };
  const actualParams = manualConsumer.setupListShardParams(stream);
  t.deepEqual(expectedParams, actualParams);
});

test('setupListShardParams returns params with StreamCreationTimestamp if it is provided', (t) => {
  const stream = 'stream-1234';
  const creationTimestamp = '1969-12-31T16:00:00.000Z';
  const expectedParams = {
    StreamName: stream,
    StreamCreationTimestamp: new Date(creationTimestamp),
  };
  const actualParams = manualConsumer.setupListShardParams(stream, creationTimestamp);
  t.deepEqual(expectedParams, actualParams);
});

// Tests for processRecordBatch stub out the processRecord function
// because it is extensively tested in test-kinesis-consumer.js
test.serial('processRecordBatch calls processRecord on each valid record and returns the number of records processed', async (t) => {
  const processRecord = sinon.stub(messageConsumer, 'processRecord').returns(true);

  try {
    const result = await manualConsumer.processRecordBatch('fake-stream-arn', [
      { Data: 'record1', ApproximateArrivalTimestamp: Date.now() },
      { Data: 'record2', ApproximateArrivalTimestamp: Date.now() },
    ],
    rulesArray);

    t.is(result, 2);
    t.true(processRecord.calledTwice);
    t.deepEqual(processRecord.args[0][0], {
      eventSourceARN: 'fake-stream-arn',
      kinesis: {
        data: 'record1',
      },
    });
    t.deepEqual(processRecord.args[0][2], rulesArray);
    t.deepEqual(processRecord.args[1][0], {
      eventSourceARN: 'fake-stream-arn',
      kinesis: {
        data: 'record2',
      },
    });
    t.deepEqual(processRecord.args[1][2], rulesArray);
  } finally {
    processRecord.restore();
  }
});

test.serial('processRecordBatch skips records newer than the endTimestamp and logs info', async (t) => {
  const processRecord = sinon.stub(messageConsumer, 'processRecord').returns(true);
  const logInfo = sinon.spy(log, 'info');
  process.env.endTimestamp = new Date(Date.now() - 1000);
  const result = await manualConsumer.processRecordBatch('fake-stream-arn', [
    { Data: 'record1', ApproximateArrivalTimestamp: Date.now() },
    { Data: 'record2', ApproximateArrivalTimestamp: Date.now() },
  ]);

  processRecord.restore();
  logInfo.restore();
  delete process.env.endTimestamp;

  t.is(result, 0);
  t.true(logInfo.called);
  t.true(processRecord.notCalled);
});

test.serial('processRecordBatch logs errors for processRecord failures and does not count them as successes', async (t) => {
  const processRecord = sinon.stub(messageConsumer, 'processRecord').throws();
  const logError = sinon.spy(log, 'error');
  const logWarn = sinon.spy(log, 'warn');
  const result = await manualConsumer.processRecordBatch('fake-stream-arn', [
    { Data: 'record1', ApproximateArrivalTimestamp: Date.now() },
    { Data: 'record2', ApproximateArrivalTimestamp: Date.now() },
  ]);

  processRecord.restore();
  logError.restore();
  logWarn.restore();

  t.true(processRecord.calledTwice);
  t.true(logError.calledTwice);
  t.true(logWarn.calledOnce);
  t.is(result, 0);
});

test.serial('iterateOverShardRecursively catches and logs failure of getRecords', async (t) => {
  const logError = sinon.spy(log, 'error');

  try {
    await manualConsumer.iterateOverShardRecursively('fake-stream-arn', [], 'fakeIterator');
    t.true(logError.calledOnce);
  } finally {
    logError.restore();
  }
});

test.serial('iterateOverShardRecursively recurs until MillisBehindLatest reaches 0', async (t) => {
  let recurred = false;
  const getRecordsStub = sinon.stub(Kinesis, 'getRecords').callsFake(() => {
    const response = {
      Records: [{}],
      NextShardIterator: '123456',
      MillisBehindLatest: recurred ? 0 : 100,
    };
    recurred = true;
    return Promise.resolve(response);
  });
  const processRecordStub = sinon.stub(messageConsumer, 'processRecord').returns(true);
  try {
    const existingPromiseList = [Promise.resolve(2), Promise.resolve(0)];
    const output = await manualConsumer.iterateOverShardRecursively('fake-stream-arn', existingPromiseList, 'fakeIterator');
    t.true(processRecordStub.calledTwice);
    t.deepEqual(await Promise.all(output), [2, 0, 1, 1]);
  } finally {
    processRecordStub.restore();
    getRecordsStub.restore();
  }
});

test.serial('processShard catches and logs failure of getShardIterator', async (t) => {
  const logError = sinon.spy(log, 'error');
  const processRecordBatch = sinon.spy(manualConsumer, 'processRecordBatch');
  await manualConsumer.processShard('nonexistentStream', 'non-existent-arn', 'nonexistentShard');
  logError.restore();
  t.true(logError.calledOnce);
  t.false(processRecordBatch.called);
});

test.serial('processShard returns number of records processed from shard', async (t) => {
  const restoreKinesis = manualConsumer.__set__('Kinesis', {
    getShardIterator: () => ({
      promise: () => Promise.resolve({
        ShardIterator: 'fakeIterator',
      }),
    }),
  });
  const logError = sinon.spy(log, 'error');
  const restoreProcessShard = manualConsumer.__set__('iterateOverShardRecursively', () => [Promise.resolve(2), Promise.resolve(3)]);
  const output = await manualConsumer.processShard('fakestream', 'fake-stream-arn', 'fakeshard');
  logError.restore();
  restoreProcessShard();
  restoreKinesis();
  t.is(output, 5);
  t.false(logError.called);
});

test.serial('iterateOverStreamRecursivelyToDispatchShards catches and logs listShards failure, then exits', async (t) => {
  const logError = sinon.spy(log, 'error');
  const inputList = [Promise.resolve(4)];
  const output = await manualConsumer.iterateOverStreamRecursivelyToDispatchShards('fakeStream', 'fake-arn', inputList, 'badParams');
  t.deepEqual(output, inputList);
  t.true(logError.calledTwice);
});

test.serial('iterateOverStreamRecursivelyToDispatchShards recurs until listShards does not contain a NextToken', async (t) => {
  let recurred = false;
  const restoreKinesis = manualConsumer.__set__('Kinesis', {
    listShards: () => ({
      promise: () => {
        const response = {
          Shards: [{}],
          NextToken: recurred ? undefined : '123456',
        };
        recurred = true;
        return Promise.resolve(response);
      },
    }),
  });
  const restoreHandleShard = manualConsumer.__set__('processShard', () => Promise.resolve(1));
  const output = await manualConsumer.iterateOverStreamRecursivelyToDispatchShards('fakestream', 'fake-arn', [], {});
  restoreHandleShard();
  restoreKinesis();
  t.deepEqual(await Promise.all(output), [1, 1]);
});

test.serial('processStream returns records processed', async (t) => {
  const restoreProcessStream = manualConsumer.__set__('iterateOverStreamRecursivelyToDispatchShards', () => [Promise.resolve(12), Promise.resolve(13)]);
  const output = await manualConsumer.processStream('fakestream', 'faketimestamp');
  restoreProcessStream();
  t.is(output, 'Processed 25 kinesis records from stream fakestream');
});

test.serial('processStream does not throw error if describeStream throws', async (t) => {
  const restoreProcessStream = manualConsumer.__set__(
    'iterateOverStreamRecursivelyToDispatchShards',
    () => [Promise.resolve(5)]
  );

  describeStreamStub.restore();
  describeStreamStub = sinon.stub(kinesisUtils, 'describeStream')
    .callsFake(() => Promise.reject(new Error('error')));

  try {
    await t.notThrowsAsync(
      manualConsumer.processStream('fakestream', 'faketimestamp')
    );
  } finally {
    restoreProcessStream();
    describeStreamStub.restore();
  }
});

test.serial('handler sets timestamp envs from event', async (t) => {
  const event = {
    endTimestamp: '1969-12-31T16:00:00.000Z',
    startTimestamp: '1969-12-31T16:00:00.000Z',
  };
  await manualConsumer.handler(event);

  Object.keys(event).forEach((key) => t.is(process.env[key], event[key]));
  Object.keys(event).forEach((key) => delete process.env[key]);
});

test.serial('handler should not overwrite existing timestamp envs', async (t) => {
  const originalEnvs = {
    endTimestamp: '1969-12-31T16:00:00.000Z',
    startTimestamp: '1969-12-31T16:00:00.000Z',
  };
  const event = {};
  Object.keys(originalEnvs).forEach((key) => {
    process.env[key] = originalEnvs[key];
    event[key] = 'fail';
  });
  await manualConsumer.handler(event);

  Object.keys(originalEnvs).forEach((key) => t.is(process.env[key], originalEnvs[key]));
  Object.keys(originalEnvs).forEach((key) => delete process.env[key]);
});

test('handler returns error string if no valid param is provided to determine intended operation', async (t) => {
  t.is(await manualConsumer.handler({}), 'Manual consumer could not determine expected operation from event {}');
});

test.serial('handler calls processStream if valid parameters are provided', async (t) => {
  const logInfo = sinon.spy(log, 'info');
  const expectedOutput = 'testing-output';
  const restorefetchEnabledRules = manualConsumer.__set__('fetchEnabledRules', () => Promise.resolve(rulesArray));
  const restoreprocessStream = manualConsumer.__set__('processStream', () => Promise.resolve(expectedOutput));
  const actualOutput = await manualConsumer.handler({ type: 'kinesis', kinesisStream: 'validstream' });
  logInfo.restore();
  restoreprocessStream();
  restorefetchEnabledRules();
  t.is(actualOutput, expectedOutput);
  t.true(logInfo.calledOnce);
});

test.serial('handler calls fetchEnabledRules if valid parameters are provided', async (t) => {
  const fetchEnabledRulesStub = sinon.stub().callsFake(() => {
    t.is(process.env.stackName, fakeStackName);
    return Promise.resolve(rulesArray);
  });
  const restorefetchEnabledRules = manualConsumer.__set__('fetchEnabledRules', fetchEnabledRulesStub);
  const restoreprocessStream = manualConsumer.__set__('processStream', (_1, _2, rulesArg) => {
    t.deepEqual(rulesArg, rulesArray);
    return Promise.resolve({});
  });
  process.env.stackName = fakeStackName;
  await manualConsumer.handler({ type: 'kinesis', kinesisStream: 'validstream' });
  delete process.env.stackName;
  restorefetchEnabledRules();
  restoreprocessStream();

  t.true(fetchEnabledRulesStub.calledOnce);
});
