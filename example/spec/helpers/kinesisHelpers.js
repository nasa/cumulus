'use strict';

const pRetry = require('p-retry');
const moment = require('moment');

const { Kinesis } = require('aws-sdk');
const { receiveSQSMessages } = require('@cumulus/common/aws');
const { sleep } = require('@cumulus/common/util');

const {
  LambdaStep,
  getExecutions
} = require('@cumulus/integration-tests');

const { loadConfig } = require('../helpers/testUtils');

const testConfig = loadConfig();

const lambdaStep = new LambdaStep();

const kinesis = new Kinesis({ apiVersion: '2013-12-02', region: testConfig.awsRegion });

const maxExecutionResults = 20;
const waitPeriodMs = 1000;

/**
 * Helper to simplify common setup code.  wraps function in try catch block
 * that will run 'cleanupCallback', then exit tests if the initial setup conditions fail.
 *
 * @param {function} cleanupCallback - Function to execute if passed in function fails
 * @param {Function} wrappedFunction - async function to execute
 * @param {iterable} args - arguments to pass to the function.
 * @returns {Promise} - returns Promise returned by wrappedFunction if no exceptions are thrown.
 */
async function tryCatchExit(cleanupCallback, wrappedFunction, ...args) {
  try {
    return await wrappedFunction.apply(this, args);
  } catch (error) {
    console.log(`${error}`);
    console.log("Tests conditions can't get met...exiting.");
    try {
      await cleanupCallback();
    } catch (e) {
      console.log(`Cleanup failed, ${e}.   Stack may need to be manually cleaned up.`);
    }
    // We should find a better way to do this
    process.exit(1); // eslint-disable-line no-process-exit
  }
}

/**
 * returns stream status from aws-sdk
 *
 * @param {string} StreamName - Stream name in AWS
 * @returns {string} stream status
 */
async function getStreamStatus(StreamName) {
  const stream = await kinesis.describeStream({ StreamName }).promise();
  return stream.StreamDescription.StreamStatus;
}

/**
 * Wait for a number of periods for a kinesis stream to become active.
 *
 * @param {string} streamName - name of kinesis stream to wait for
 * @param {string} initialDelaySecs - 1 time wait period before finding stream.
                                      Default value 10 seconds.
 * @param {integer} maxRetries - number of retries to attempt before failing.
 *                               default value 10
 * @returns {string} current stream status: 'ACTIVE'
 * @throws {Error} - Error describing current stream status
 */
async function waitForActiveStream(streamName, initialDelaySecs = 10, maxRetries = 10) {
  let streamStatus = 'UNDEFINED';
  let stream;
  const displayName = streamName.split('-').pop();

  await sleep(initialDelaySecs * 1000);

  return pRetry(
    async () => {
      stream = await kinesis.describeStream({ StreamName: streamName }).promise();
      streamStatus = stream.StreamDescription.StreamStatus;
      if (streamStatus === 'ACTIVE') return streamStatus;
      throw new Error(`Stream never became active:  status: ${streamStatus}: ${streamName}`);
    },
    {
      minTimeout: 3 * 1000,
      factor: 1.45,
      retries: maxRetries,
      onFailedAttempt: (error) => {
        console.log(`Stream in state ${streamStatus} retrying. ${error.attemptsLeft} remain on ${displayName} at ${new Date().toString()}`);
      }
    }
  );
}

/**
 * Helper function to delete a stream by name
 *
 * @param {string} streamName - name of kinesis stream to delete
 * @returns {Promise<Object>} - a kinesis delete stream proxy object.
 */
async function deleteTestStream(streamName) {
  return kinesis.deleteStream({ StreamName: streamName }).promise();
}


/**
 * patiently create a kinesis stream
 *
 * @param {string} streamName - name of kinesis stream to create
 * @returns {Promise<Object>} - kinesis create stream promise if stream to be created.
 */
async function createKinesisStream(streamName) {
  return pRetry(
    async () => {
      try {
        return kinesis.createStream({ StreamName: streamName, ShardCount: 1 }).promise();
      } catch (error) {
        if (error.code === 'LimitExceededException') throw new Error('Trigger retry');
        throw new pRetry.AbortError(error);
      }
    },
    {
      onFailedAttempt: () => console.log('LimitExceededException when calling kinesis.createStream(), will retry.')
    }
  );
}

/**
 *  returns a active kinesis stream, creating it if necessary.
 *
 * @param {string} streamName - name of stream to return
 * @returns {Object} empty object if stream is created and ready.
 * @throws {Error} Kinesis error if stream cannot be created.
 */
async function createOrUseTestStream(streamName) {
  let stream;

  try {
    stream = await kinesis.describeStream({ StreamName: streamName }).promise();
  } catch (err) {
    if (err.code === 'ResourceNotFoundException') {
      console.log('Creating a new stream:', streamName);
      stream = await createKinesisStream(streamName);
    } else {
      console.log(`describeStream error ${err}`);
      throw err;
    }
  }
  return stream;
}

/**
 * Gets the shard iterator for stream <streamName> using LATEST: Records written to
 * the stream after this shard iterator is retrieved will be returned by calls
 * to GetRecords. NOTE: Shard iterators expire after 5 minutes if not used in a
 * GetRecords call.
 *
 * @param  {string} streamName - Name of the stream of interest
 * @returns {string}            - Shard iterator
 */
async function getShardIterator(streamName) {
  const describeStreamParams = {
    StreamName: streamName
  };

  const streamDetails = await kinesis.describeStream(describeStreamParams).promise();
  const shardId = streamDetails.StreamDescription.Shards[0].ShardId;
  const startingSequenceNumber = streamDetails.StreamDescription.Shards[0].SequenceNumberRange.StartingSequenceNumber;

  const shardIteratorParams = {
    ShardId: shardId, /* required */
    ShardIteratorType: 'AT_SEQUENCE_NUMBER',
    StartingSequenceNumber: startingSequenceNumber,
    StreamName: streamName
  };

  const shardIterator = await kinesis.getShardIterator(shardIteratorParams).promise();
  return shardIterator.ShardIterator;
}

/**
 * Gets records from a kinesis stream using a shard iterator.
 *
 * @param {string} shardIterator - Kinesis stream shard iterator. Shard
 *   iterators must be generated using getShardIterator.
 * @param {Array} records
 * @returns {Array} Array of records from kinesis stream.
 */
async function getRecords(shardIterator, records = []) {
  const data = await kinesis.getRecords({ ShardIterator: shardIterator }).promise();
  records.push(...data.Records);
  if ((data.NextShardIterator !== null) && (data.MillisBehindLatest > 0)) {
    await sleep(waitPeriodMs);
    return getRecords(data.NextShardIterator, records);
  }
  return records;
}

/**
 * add a record to the kinesis stream.
 *
 * @param {string} streamName - kinesis stream name
 * @param {Object} record - CNM object to drop on stream
 * @returns {Promise<Object>} - Kinesis putRecord response proxy object.
 */
async function putRecordOnStream(streamName, record) {
  return kinesis.putRecord({
    Data: JSON.stringify(record),
    PartitionKey: '1',
    StreamName: streamName
  }).promise();
}

/**
 * Wait for a certain number of test stepfunction executions to exist.
 *
 * @param {string} recordIdentifier - random string identifying correct execution for test
 * @param {string} workflowName - name of the workflow to wait for
 * @param {integer} maxWaitTimeSecs - maximum time to wait for the correct execution in seconds
 * @param {integer} numExecutions - The number of executions to wait for
 * @param {string} firstStep - The name of the first step of the workflow, used to query if the workflow has started.
 * @returns {Object} - {executionArn: <arn>, status: <status>}
 * @throws {Error} - any AWS error, re-thrown from AWS execution or 'Workflow Never Started'.
 */
async function waitForAllTestSf(recordIdentifier, workflowName, maxWaitTimeSecs, numExecutions, firstStep = 'SfSnsReport') {
  let timeWaitedSecs = 0;
  const workflowExecutions = [];
  const startTime = moment();

  /* eslint-disable no-await-in-loop */
  while (timeWaitedSecs < maxWaitTimeSecs && workflowExecutions.length < numExecutions) {
    await sleep(waitPeriodMs);
    timeWaitedSecs = (moment.duration(moment().diff(startTime)).asSeconds());
    const executions = await getExecutions(workflowName, testConfig.stackName, testConfig.bucket, maxExecutionResults);
    // Search all recent executions for target recordIdentifier
    for (let ctr = 0; ctr < executions.length; ctr += 1) {
      const execution = executions[ctr];
      if (!workflowExecutions.find((e) => e.executionArn === execution.executionArn)) {
        const taskInput = await lambdaStep.getStepInput(execution.executionArn, firstStep);
        if (taskInput !== null && taskInput.payload.identifier === recordIdentifier) {
          workflowExecutions.push(execution);
          if (workflowExecutions.length === numExecutions) {
            break;
          }
        }
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  if (workflowExecutions.length > 0) return workflowExecutions;
  throw new Error('Never found started workflow.');
}

/**
 * Wait for test stepfunction execution to exist.
 *
 * @param {string} recordIdentifier - random string identifying correct execution for test
 * @param {string} workflowName - name of the workflow to wait for
 * @param {integer} maxWaitTimeSecs - maximum time to wait for the correct execution in seconds
 * @param {string} firstStep - The name of the first step of the workflow, used to query if the workflow has started.
 * @returns {Object} - {executionArn: <arn>, status: <status>}
 * @throws {Error} - any AWS error, re-thrown from AWS execution or 'Workflow Never Started'.
 */
async function waitForTestSf(recordIdentifier, workflowName, maxWaitTimeSecs, firstStep = 'SfSnsReport') {
  const workflowExecutions = await waitForAllTestSf(recordIdentifier, workflowName, maxWaitTimeSecs, 1, firstStep);

  return workflowExecutions[0];
}

/**
 * Return the original kinesis event embedded in an SQS message.
 *
 * @param {Object} message - SQS message
 * @returns {Object} kinesis object stored in SQS message.
 */
function kinesisEventFromSqsMessage(message) {
  let kinesisEvent;
  try {
    const originalKinesisMessage = JSON.parse(message.Body.Records[0].Sns.Message);
    const dataString = Buffer.from(originalKinesisMessage.kinesis.data, 'base64').toString();
    kinesisEvent = JSON.parse(dataString);
  } catch (error) {
    console.log('Error parsing KinesisEventFromSqsMessage(message)', JSON.stringify(message));
    console.log(error);
    kinesisEvent = { identifier: 'Fake Wrong Message' };
  }
  return kinesisEvent;
}

/**
 * Check if the returned SQS message holds the targeted kinesis record.
 *
 * @param {Object} message - SQS message.
 * @param {string} recordIdentifier - target kinesis record identifier.
 * @returns {Bool} - true, if this message contained the targeted record identifier.
 */
function isTargetMessage(message, recordIdentifier) {
  const kinesisEvent = kinesisEventFromSqsMessage(message);
  return kinesisEvent.identifier === recordIdentifier;
}

/**
 * Scan the queue as fast as possible to get all of the records that are
 * available and see if any contain the recordIdentifier.  Do this scan faster
 * than the visibilityTimeout of the messages you read to ensure reading all
 * messages in the queue.
 *
 * We are working across purposes at this point, a queue is not designed to be
 * searched, so we need to find the message that contains the record identifier
 * before the timeout of the messages.
 * @param {string} queueUrl - SQS Queue url
 * @param {string} recordIdentifier - identifier in the original kinesis message to match.
 */
async function scanQueueForMessage(queueUrl, recordIdentifier) {
  const sqsOptions = { numOfMessages: 10, timeout: 40, waitTimeSeconds: 2 };
  const messages = await receiveSQSMessages(queueUrl, sqsOptions);
  if (messages.length > 0) {
    console.log(`messages retrieved: ${messages.length}`);
    const targetMessage = messages.find((message) => isTargetMessage(message, recordIdentifier));
    if (targetMessage) return targetMessage;
    return scanQueueForMessage(queueUrl, recordIdentifier);
  }
  throw new Error('Message Not Found');
}

/**
 * Wait until a kinesisRecord appears in an SQS message who's identifier matches the input recordIdentifier.
 *
 * @param {string} recordIdentifier - random string to match found kinesis messages against.
 * @param {string} queueUrl - kinesisFailure SQS url
 * @param {number} maxRetries - number of retries
 * @returns {Object} - matched Message from SQS.
 */
async function waitForQueuedRecord(recordIdentifier, queueUrl, maxRetries = 15) {
  return pRetry(
    async () => {
      try {
        return await scanQueueForMessage(queueUrl, recordIdentifier);
      } catch (error) {
        throw new Error(`Never found ${recordIdentifier} on Queue`);
      }
    },
    {
      minTimeout: 1 * 1000,
      maxTimeout: 60 * 1000,
      retries: maxRetries,
      onFailedAttempt: (error) => {
        console.log(`No message on Queue. ${error.attemptsLeft} retries remain. ${new Date().toLocaleString()}`);
      }
    }
  );
}

module.exports = {
  createOrUseTestStream,
  deleteTestStream,
  getShardIterator,
  getStreamStatus,
  getRecords,
  kinesisEventFromSqsMessage,
  putRecordOnStream,
  tryCatchExit,
  waitForActiveStream,
  waitForAllTestSf,
  waitForQueuedRecord,
  waitForTestSf
};
