'use strict';

const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');

const { processRecord } = require('./message-consumer');

const Kinesis = aws.kinesis();
const tallyReducer = (acc, cur) => acc + cur;

/**
 * Process a batch of kinesisRecords.
 *
 * @param {Array<Object>} records - list of kinesis records
 * @returns {number} number of records successfully processed
 */
async function processRecords(records) {
  const results = await Promise.all(records.map(async (record) => {
    if (new Date(record.ApproximateArrivalTimestamp) > new Date(process.env.endTimestamp)) {
      return 0;
    }
    try {
      await processRecord({ kinesis: { data: record.Data } });
      return 1;
    } catch (err) {
      log.error(err);
      return 0;
    }
  }));
  const tally = results.reduce(tallyReducer, 0);
  if (records.length > tally) {
    const failures = records.length - tally;
    log.debug(`Failed to process ${failures} records from batch of ${records.length}`);
  }
  return tally;
}

/**
 * Recursively process all records within a shard between start and end timestamps.
 * Starts at beginning of shard (TRIM_HORIZON) if no start timestamp is available.
 *
 * @param {Array<Promise>} recordPromiseList - list of promises from calls to processRecords
 * @param {string} shardIterator - ShardIterator Id
 * @returns {Array<Promise>} list of promises from calls to processRecords
 */
async function processShard(recordPromiseList, shardIterator) {
  const response = await Kinesis.getRecords({
    ShardIterator: shardIterator
  }).promise().catch(log.error);
  const nextShardIterator = response.NextShardIterator;
  recordPromiseList.push(processRecords(response.Records));
  if (response.MillisBehindLatest === 0) return recordPromiseList;
  return processShard(recordPromiseList, nextShardIterator);
}

/**
 * Handle shard by creating shardIterator and calling processShard.
 *
 * @param {string} stream - kinesis stream name
 * @param {Object} shard - shard object returned by listShards
 * @returns {number} number of records successfully processed from shard
 */
async function handleShard(stream, shard) {
  const params = {
    StreamName: stream,
    ShardId: shard.ShardId,
    ShardIteratorType: (process.env.startTimestamp !== 'undefined' ? 'AT_TIMESTAMP' : 'TRIM_HORIZON')
  };
  if (process.env.startTimestamp !== 'undefined') params.Timestamp = process.env.startTimestamp;
  const shardIterator = (
    await Kinesis.getShardIterator(params).promise().catch(log.error)
  ).ShardIterator;
  const tallyList = await Promise.all(await processShard([], shardIterator));
  const shardTally = tallyList.reduce(tallyReducer, 0);
  return shardTally;
}

/**
 * Recursively fetch all records within a kinesis stream and process them through
 * message-consumer's processRecord function.
 *
 * @param {string} stream - Kinesis stream name
 * @param {Array<Promise>} shardPromiseList - list of promises from calls to processShard
 * @param {Object} params - listShards query params
 * @returns {Array<Promise>} list of promises from calls to processShard
 */
async function processStream(stream, shardPromiseList, params) {
  const data = (await Kinesis.listShards(params).promise().catch(log.error));
  if (!data || !data.Shards || data.Shards.length === 0) {
    log.error(`No shards founds for params ${JSON.stringify(params)}.`);
    return shardPromiseList;
  }
  log.info(`Processing records from ${data.Shards.length} shards..`);
  const shardCalls = data.Shards.map((shard) => handleShard(stream, shard).catch(log.error));
  shardPromiseList.push(...shardCalls);
  if (!data.NextToken) {
    return shardPromiseList;
  }
  const newParams = { NextToken: data.NextToken };
  return processStream(stream, shardPromiseList, newParams);
}

/**
 * Fetch all records within a kinesis stream and process them through
 * message-consumer's processRecord function.
 *
 * @param {string} stream - kinesis stream name
 * @param {Date|string|number} [streamCreationTimestamp] - Optional. Stream
 * creation time stamp used to differentiate streams that have a name used by a previous stream.
 * @returns {number} number of records successfully processed from stream
 */
async function handleStream(stream, streamCreationTimestamp) {
  const initialParams = {
    StreamName: stream
  };
  if (streamCreationTimestamp) initialParams.StreamCreationTimestamp = streamCreationTimestamp;
  const streamPromiseList = await processStream(stream, [], initialParams);
  const streamResults = await Promise.all(streamPromiseList);
  const recordsProcessed = streamResults.reduce(tallyReducer, 0);
  const outMsg = `Processed ${recordsProcessed} kinesis records from stream ${stream}`;
  log.info(outMsg);
  return outMsg;
}

/**
 * Manual Consumer handler. Determines operation from input.
 * Supports manually consuming:
 * - Kinesis records.
 *
 * @param {Object} event - input params object
 * @returns {string} String describing outcome
 */
async function handler(event) {
  if (!process.env.endTimestamp) process.env.endTimestamp = event.endTimestamp;
  if (!process.env.startTimestamp) process.env.startTimestamp = event.startTimestamp;
  if (!process.env.CollectionsTable) process.env.CollectionsTable = event.collectionsTable;
  if (!process.env.RulesTable) process.env.RulesTable = event.rulesTable;
  if (!process.env.ProvidersTable) process.env.ProvidersTable = event.providersTable;
  if (!process.env.system_bucket) process.env.system_bucket = event.system_bucket;
  if (!process.env.FallbackTopicArn) process.env.FallbackTopicArn = event.fallbackTopicArn;

  if (event.kinesisStream !== undefined) {
    log.info(`Processing records from stream ${event.kinesisStream}`);
    return handleStream(event.kinesisStream, event.kinesisStreamCreationTimestamp);
  }

  const errMsg = 'Manual consumer could not determine expected operation.';
  log.fatal(errMsg);
  return errMsg;
}

module.exports = {
  handler
};
