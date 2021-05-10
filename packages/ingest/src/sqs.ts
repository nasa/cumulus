'use strict';

import Logger from '@cumulus/logger';
import { SQSMessage } from '@cumulus/aws-client/SQS';
import { envUtils } from '@cumulus/common';
import { s3PutObject, deleteS3Object } from '@cumulus/aws-client/S3';

const logger = new Logger({ sender: '@cumulus/ingest/sqs' });

function getS3KeyForArchivedMessage(stackName: string, messageId: string) {
  const key = `${stackName}/archived-incoming-messages/${messageId}`;
  return key;
}

/**
 * Archives incoming SQS Message into S3
 *
 * @param {Object} message - SQS message
 * @returns {undefined}
 */
export async function archiveSqsMessageToS3(message: SQSMessage) {
  const bucket = envUtils.getRequiredEnvVar('system_bucket', process.env);
  const stackName = envUtils.getRequiredEnvVar('stackName', process.env);

  if (!message.MessageId) {
    const error = new Error(`MessageId on message ${message} required but not found.`)
    logger.error(error.message);
    throw error;
  }

  const key = getS3KeyForArchivedMessage(stackName, message.MessageId);
  const body = JSON.stringify(message.Body);
  try {
    await s3PutObject({
      Bucket: bucket,
      Key: key,
      Body: body,
    });
    logger.debug(`Archived ${message.MessageId} from queue`);
  } catch (error) {
    logger.error(`Could not write to bucket. ${error}`);
    throw error;
  }
}

/**
 * Deletes archived SQS Message from S3
 *
 * @param {Object} messageId - SQS message ID
 * @returns {undefined}
 */
export async function deleteArchivedMessageFromS3(messageId: string) {
  const bucket = envUtils.getRequiredEnvVar('system_bucket', process.env);
  const stackName = envUtils.getRequiredEnvVar('stackName', process.env);
  const key = getS3KeyForArchivedMessage(stackName, messageId);
  try {
    await deleteS3Object(bucket, key);
    logger.info(`Deleted archived message ${messageId} from S3 at ${bucket}/${key}`);
  } catch (error) {
    logger.error(`Could not delete message from bucket. ${error}`);
    throw error;
  }
}
