'use strict';

const pMap = require('p-map');

const { envUtils } = require('@cumulus/common');
const { getJsonS3Object, listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const { getQueueUrlByName, sqsSendMessageBatch } = require('@cumulus/aws-client/SQS');
const { getS3PrefixForArchivedMessage } = require('@cumulus/ingest/sqs');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/replay-sqs-messages' });

// Get messages from S3 using queueName
const getArchivedMessagesFromQueue = async (queueName) => {
  let continuationToken;
  const validMessages = [];
  const bucket = envUtils.getRequiredEnvVar('system_bucket', process.env);
  const stackName = envUtils.getRequiredEnvVar('stackName', process.env);
  const prefix = getS3PrefixForArchivedMessage(stackName, queueName);
  const params = {
    Bucket: bucket,
    Prefix: prefix,
    ContinuationToken: continuationToken,
    Delimiter: '/',
  };
  logger.debug(`Params for listS3Keys bucket: ${bucket}, prefix: ${prefix}`);

  const messageObjects = await listS3ObjectsV2(params);
  const archivedMessages = await Promise.allSettled(messageObjects.map(
    async (messageObject) => {
      const sqsMessage = await getJsonS3Object(bucket, messageObject.Key);
      logger.debug(`Message retrieved ${JSON.stringify(sqsMessage)}`);
      return sqsMessage;
    }
  ));
  archivedMessages.map((message) => {
    if (message.status === 'fulfilled') {
      validMessages.push(message.value);
    }
    return validMessages;
  });
  return validMessages;
};

async function replaySqsMessages(event) {
  const replayedMessages = [];
  const queueName = event.queueName;
  const queueUrl = await getQueueUrlByName(queueName);
  const messagesToReplay = await getArchivedMessagesFromQueue(event.queueName);
  const listOfBatchedMessages = [];
  while (messagesToReplay.length > 0) {
    listOfBatchedMessages.push(messagesToReplay.splice(0, 10));
  }
  await pMap(
    listOfBatchedMessages,
    async (batchedMessages) => {
      try {
        await sqsSendMessageBatch(queueUrl, batchedMessages);
        logger.info(`Successfully sent batch of messages to queue URL ${queueUrl}`);
        replayedMessages.push(batchedMessages);
      } catch (error) {
        logger.error(`Could not send batch of messages to queue. Message Batch: ${JSON.stringify(batchedMessages)}, Queue: ${queueUrl}`, error);
        throw error;
      }
    },
    {
      stopOnError: false,
    }
  );

  return replayedMessages.flat();
}

async function handler(event) {
  return await replaySqsMessages(event);
}

module.exports = {
  handler,
  replaySqsMessages,
  getArchivedMessagesFromQueue,
};
