'use strict';

const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const log = require('@cumulus/common/log');

const messageConsumer = require('../../lambdas/message-consumer');
const manualConsumer = rewire('../../lambdas/manual-consumer');

test.serial('configureTimestampEnvs throws error when invalid endTimestamp is provided', (t) => {
  const event = {
    endTimestamp: Date.now().toString()
  };
  t.throws(
    () => manualConsumer.configureTimestampEnvs(event),
    `endTimestamp ${event.endTimestamp} is not a valid input for new Date().`
  );
  delete process.env.endTimestamp;
});

test.serial('configureTimestampEnvs throws error when invalid startTimestamp is provided', (t) => {
  const event = {
    startTimestamp: Date.now().toString()
  };
  t.throws(
    () => manualConsumer.configureTimestampEnvs(event),
    `startTimestamp ${event.startTimestamp} is not a valid input for new Date().`
  );
  delete process.env.endTimestamp;
});

test('setupIteratorParams returns TRIM_HORIZON iterator params if timestamp env is not set', (t) => {
  const stream = 'stream-1234';
  const shardId = 'shard-1234';
  const expectedParams = {
    StreamName: stream,
    ShardId: shardId,
    ShardIteratorType: 'TRIM_HORIZON'
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
    Timestamp: process.env.startTimestamp
  };
  const actualParams = manualConsumer.setupIteratorParams(stream, shardId);
  delete process.env.startTimestamp;
  t.deepEqual(expectedParams, actualParams);
});

test('setupListShardParams returns params with no StreamCreationTimestamp if it is omitted', (t) => {
  const stream = 'stream-1234';
  const expectedParams = {
    StreamName: stream
  };
  const actualParams = manualConsumer.setupListShardParams(stream);
  t.deepEqual(expectedParams, actualParams);
});

test('setupListShardParams returns params with StreamCreationTimestamp if it is provided', (t) => {
  const stream = 'stream-1234';
  const creationTimestamp = '1969-12-31T16:00:00.000Z';
  const expectedParams = {
    StreamName: stream,
    StreamCreationTimestamp: new Date(creationTimestamp)
  };
  const actualParams = manualConsumer.setupListShardParams(stream, creationTimestamp);
  t.deepEqual(expectedParams, actualParams);
});

// Tests for processRecordBatch stub out the processRecord function
// because it is extensively tested in test-kinesis-consumer.js
test.serial('processRecordBatch calls processRecord on each valid record and returns the number of records processed', async (t) => {
  const processRecord = sinon.stub(messageConsumer, 'processRecord').returns(true);
  const result = await manualConsumer.processRecordBatch([
    { Data: 'record1', ApproximateArrivalTimestamp: Date.now() },
    { Data: 'record2', ApproximateArrivalTimestamp: Date.now() }
  ]);

  processRecord.restore();

  t.is(result, 2);
  t.true(processRecord.calledTwice);
});

test.serial('processRecordBatch skips records newer than the endTimestamp and logs info', async (t) => {
  const processRecord = sinon.stub(messageConsumer, 'processRecord').returns(true);
  const logInfo = sinon.spy(log, 'info');
  process.env.endTimestamp = new Date(Date.now() - 1000);
  const result = await manualConsumer.processRecordBatch([
    { Data: 'record1', ApproximateArrivalTimestamp: Date.now() },
    { Data: 'record2', ApproximateArrivalTimestamp: Date.now() }
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
  const result = await manualConsumer.processRecordBatch([
    { Data: 'record1', ApproximateArrivalTimestamp: Date.now() },
    { Data: 'record2', ApproximateArrivalTimestamp: Date.now() }
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
  await manualConsumer.iterateOverShardRecursively([], 'fakeIterator');

  logError.restore();

  t.true(logError.calledOnce);
});

test.serial('iterateOverShardRecursively recurs until MillisBehindLatest reaches 0', async (t) => {
  let recurred = false;
  const restoreKinesis = manualConsumer.__set__('Kinesis', {
    getRecords: () => ({
      promise: () => {
        const response = {
          Records: [{}],
          NextShardIterator: '123456',
          MillisBehindLatest: recurred ? 0 : 100
        };
        recurred = true;
        return Promise.resolve(response);
      }
    })
  });
  const existingPromiseList = [Promise.resolve(2), Promise.resolve(0)];
  const processRecord = sinon.stub(messageConsumer, 'processRecord').returns(true);
  const output = await manualConsumer.iterateOverShardRecursively(existingPromiseList, 'fakeIterator');
  processRecord.restore();
  restoreKinesis();
  t.true(processRecord.calledTwice);
  t.deepEqual(await Promise.all(output), [2, 0, 1, 1]);
});

test.serial('processShard catches and logs failure of getShardIterator', async (t) => {
  const logError = sinon.spy(log, 'error');
  const processRecordBatch = sinon.spy(manualConsumer, 'processRecordBatch');
  await manualConsumer.processShard('nonexistentStream', 'nonexistentShard');
  logError.restore();
  t.true(logError.calledOnce);
  t.false(processRecordBatch.called);
});

test.serial('processShard returns number of records processed from shard', async (t) => {
  const restoreKinesis = manualConsumer.__set__('Kinesis', {
    getShardIterator: () => ({
      promise: () => Promise.resolve({
        ShardIterator: 'fakeIterator'
      })
    })
  });
  const logError = sinon.spy(log, 'error');
  const restoreProcessShard = manualConsumer.__set__('iterateOverShardRecursively', async () => [Promise.resolve(2), Promise.resolve(3)]);
  const output = await manualConsumer.processShard('fakestream', 'fakeshard');
  logError.restore();
  restoreProcessShard();
  restoreKinesis();
  t.is(output, 5);
  t.false(logError.called);
});

test.serial('iterateOverStreamRecursivelyToDispatchShards catches and logs listShards failure, then exits', async (t) => {
  const logError = sinon.spy(log, 'error');
  const inputList = [Promise.resolve(4)];
  const output = await manualConsumer.iterateOverStreamRecursivelyToDispatchShards('fakeStream', inputList, 'badParams');
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
          NextToken: recurred ? null : '123456'
        };
        recurred = true;
        return Promise.resolve(response);
      }
    })
  });
  const restoreHandleShard = manualConsumer.__set__('processShard', async () => Promise.resolve(1));
  const output = await manualConsumer.iterateOverStreamRecursivelyToDispatchShards('fakestream', [], {});
  restoreHandleShard();
  restoreKinesis();
  t.deepEqual(await Promise.all(output), [1, 1]);
});

test.serial('processStream returns records processed', async (t) => {
  const restoreProcessStream = manualConsumer.__set__('iterateOverStreamRecursivelyToDispatchShards', async () => [Promise.resolve(12), Promise.resolve(13)]);
  const output = await manualConsumer.processStream('fakestream', 'faketimestamp');
  restoreProcessStream();
  t.is(output, 'Processed 25 kinesis records from stream fakestream');
});

test.serial('handler sets envs from event', async (t) => {
  const event = {
    endTimestamp: '1969-12-31T16:00:00.000Z',
    startTimestamp: '1969-12-31T16:00:00.000Z',
    CollectionsTable: 'test-CollectionsTable',
    RulesTable: 'test-RulesTable',
    ProvidersTable: 'test-ProvidersTable',
    stackName: 'test-stack',
    system_bucket: 'test-bucket',
    FallbackTopicArn: 'arn:aws:sns:us-east-1:00000000000:fallbackTopic'
  };
  await manualConsumer.handler(event);

  Object.keys(event).forEach((key) => t.is(process.env[key], event[key]));
  Object.keys(event).forEach((key) => delete process.env[key]);
});


test.serial('handler should not overwrite existing envs', async (t) => {
  const originalEnvs = {
    endTimestamp: '1969-12-31T16:00:00.000Z',
    startTimestamp: '1969-12-31T16:00:00.000Z',
    CollectionsTable: 'test-CollectionsTable',
    RulesTable: 'test-RulesTable',
    ProvidersTable: 'test-ProvidersTable',
    stackName: 'test-stack',
    system_bucket: 'test-bucket',
    FallbackTopicArn: 'arn:aws:sns:us-east-1:00000000000:fallbackTopic'
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
  const restoreprocessStream = manualConsumer.__set__('processStream', () => Promise.resolve(expectedOutput));
  const actualOutput = await manualConsumer.handler({ type: 'kinesis', kinesisStream: 'validstream' });
  logInfo.restore();
  restoreprocessStream();
  t.is(actualOutput, expectedOutput);
  t.true(logInfo.calledOnce);
});
