'use strict';

const pMap = require('p-map');

const { envUtils } = require('@cumulus/common');
const { getJsonS3Object, listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const { getQueueUrlByName, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const { getS3PrefixForArchivedMessage } = require('@cumulus/ingest/sqs');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/replay-sqs-messages' });

// Get messages from S3 using queueName
const getArchivedMessagesFromQueue = async (queueName) => {
  const bucket = envUtils.getRequiredEnvVar('system_bucket', process.env);
  const stackName = envUtils.getRequiredEnvVar('stackName', process.env);
  const prefix = getS3PrefixForArchivedMessage(stackName, queueName);
  const params = {
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: '/',
  };
  logger.debug(`Params for listS3Keys bucket: ${bucket}, prefix: ${prefix}`);

  const messageObjects = await listS3ObjectsV2(params);
  const archiveRequests = await Promise.allSettled(messageObjects.map(
    async (messageObject) => {
      const sqsMessage = await getJsonS3Object(bucket, messageObject.Key);
      logger.debug(`Message retrieved ${JSON.stringify(sqsMessage)}`);
      return sqsMessage;
    }
  ));
  const archivedMessages = archiveRequests
    .filter((message) => message.status === 'fulfilled')
    .map((message) => message.value);
  return archivedMessages;
};

async function replaySqsMessages(event) {
  const replayedMessages = [];
  const queueName = event.queueName;
  const queueUrl = await getQueueUrlByName(queueName);
  const messagesToReplay = await getArchivedMessagesFromQueue(event.queueName);
  await pMap(
    messagesToReplay,
    async (message) => {
      try {
        await sendSQSMessage(queueUrl, message);
        logger.info(`Successfully sent message to queue URL ${queueUrl}`);
        replayedMessages.push(message);
      } catch (error) {
        logger.error(`Could not send message to queue. Message: ${JSON.stringify(message)}, Queue: ${queueUrl}`, error);
        throw error;
      }
    },
    {
      stopOnError: false,
    }
  );
  return replayedMessages;
}

async function handler(event) {
  return await replaySqsMessages(event);
}

module.exports = {
  handler,
  replaySqsMessages,
  getArchivedMessagesFromQueue,
};
