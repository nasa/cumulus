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
 * @returns {Array<number>} list of numbers, 1 for processed, 0 for error/skipped
 */
async function processRecords(records) {
  return Promise.all(records.map(async (record) => {
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
}

/**
 * Process all records within a shard between start and end timestamps.
 * Starts at beginning of shard (TRIM_HORIZON) if no start timestamp is given.
 *
 * @param {string} stream - Stream name
 * @param {Object} shard - Shard object returned by listShards
 * @returns {number} number of records successfully processed from shard
 */
async function processShard(stream, shard) {
  const params = {
    StreamName: stream,
    ShardId: shard.ShardId,
    ShardIteratorType: (process.env.startTimestamp !== 'undefined' ? 'AT_TIMESTAMP' : 'TRIM_HORIZON')
  };
  if (process.env.startTimestamp !== 'undefined') params.Timestamp = process.env.startTimestamp;
  let shardIter = (await Kinesis.getShardIterator(params).promise().catch(log.error)).ShardIterator;
  let records = [];
  const recordsRequests = [];
  while (shardIter !== null) {
    /* eslint-disable-next-line no-await-in-loop */
    const response = await Kinesis.getRecords({
      ShardIterator: shardIter
    }).promise().catch(log.error);
    records = response.Records;
    shardIter = response.NextShardIterator;
    if (response.MillisBehindLatest === 0) shardIter = null;
    recordsRequests.push(processRecords(records).then(
      (recArr) => recArr.reduce(tallyReducer, 0)
    ));
  }
  return (await Promise.all(recordsRequests)).reduce(tallyReducer, 0);
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
  const shardHandlers = [];
  let shardListToken;

  do {
    const params = {};
    if (shardListToken !== undefined) params.NextToken = shardListToken;
    else {
      params.StreamName = stream;
      if (streamCreationTimestamp) params.StreamCreationTimestamp = streamCreationTimestamp;
    }
    // disable eslint as listShards must be performed serially and cannot
    // be done concurrently due to reliance on previous call's NextToken
    /* eslint-disable-next-line no-await-in-loop */
    const data = (await Kinesis.listShards(params).promise().catch(log.error));
    if (!data || !data.Shards || data.Shards.length === 0) {
      log.error(`No shards found for stream ${stream}`);
      break;
    }
    log.info(`Processing records from ${data.Shards.length} shards..`);
    shardListToken = data.NextToken;
    const shardCalls = data.Shards.map((shard) => processShard(stream, shard).catch(log.error));
    shardHandlers.push(...shardCalls);
  } while (shardListToken !== undefined);
  const shardResults = await Promise.all(shardHandlers);
  const recordsProcessed = shardResults.reduce(tallyReducer, 0);
  const outMsg = `Processed ${recordsProcessed} kinesis records`;
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
