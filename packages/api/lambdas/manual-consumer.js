'use strict';

const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');

const { processRecord } = require('./message-consumer');

const Kinesis = aws.kinesis();
const tallyReducer = (acc, cur) => acc + cur;

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

async function processShard(stream, shard) {
  const params = {
    StreamName: stream,
    ShardId: shard.ShardId,
    ShardIteratorType: (process.env.startTimestamp !== 'undefined' ? 'AT_TIMESTAMP' : 'TRIM_HORIZON')
  };
  if (process.env.startTimestamp !== 'undefined') params.Timestamp = process.env.startTimestamp;
  let shardIter = (await Kinesis.getShardIterator(params).promise().catch(log.error)).ShardIterator;
  log.info(`shardIter: ${JSON.stringify(shardIter)}`);
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

async function handler(event) {
  if (!process.env.endTimestamp) process.env.endTimestamp = event.endTimestamp;
  if (!process.env.startTimestamp) process.env.startTimestamp = event.startTimestamp;
  if (!process.env.CollectionsTable) process.env.CollectionsTable = event.collectionsTable;
  if (!process.env.RulesTable) process.env.RulesTable = event.rulesTable;
  if (!process.env.ProvidersTable) process.env.ProvidersTable = event.providersTable;
  if (!process.env.system_bucket) process.env.system_bucket = event.system_bucket;
  if (!process.env.FallbackTopicArn) process.env.FallbackTopicArn = event.fallbackTopicArn;

  const stream = event.kinesisStream;
  const shardHandlers = [];
  let shardListToken;

  do {
    const params = {};
    if (shardListToken !== undefined) params.NextToken = shardListToken;
    else params.StreamName = stream;
    // disable eslint as listShards must be performed serially and cannot
    // be done concurrently due to reliance on previous call's NextToken
    /* eslint-disable-next-line no-await-in-loop */
    const data = (await Kinesis.listShards(params).promise().catch(log.error));
    if (!data) {
      log.error(`No shards found for stream ${stream}`);
      break;
    }
    log.info(`Processing records from ${data.Shards.length} shards..`);
    shardListToken = data.NextToken;
    const shardCalls = data.Shards.map((shard) => processShard(stream, shard).catch(log.error));
    shardHandlers.push(...shardCalls);
  } while (shardListToken !== undefined);
  return Promise.all(shardHandlers).then(
    (shardResults) => {
      const finalTally = shardResults.reduce(tallyReducer, 0);
      log.info(`Processed ${finalTally} records`);
      return finalTally;
    }
  );
}

module.exports = {
  handler
};
