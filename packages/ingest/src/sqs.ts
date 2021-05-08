'use strict';

import Logger from '@cumulus/logger';
import { SQSMessage } from '@cumulus/aws-client/SQS';
const { envUtils } = require('@cumulus/common');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { deleteS3Object } = require('@cumulus/aws-client/S3');
const logger = new Logger({ sender: '@cumulus/ingest/sqs' });

function getS3KeyForArchivedMessages(stackName: string, messageId?: string) {
  const key = `${stackName}/archived-incoming-messages/${messageId}`;
  return key;
}

/**
 * Archives incoming SQS Message into S3
 *
 * @param {Object} message - SQS message
 * @returns {void}
 */
export async function archiveSqsMessageToS3(message: SQSMessage) {
  const bucket = envUtils.getRequiredEnvVar('system_bucket', process.env);
  const stackName = envUtils.getRequiredEnvVar('stackName', process.env);
  const key = getS3KeyForArchivedMessages(stackName, message.MessageId);
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
 * @returns {void}
 */
export async function deleteArchivedMessageFromS3(messageId: string) {
  const bucket = envUtils.getRequiredEnvVar('system_bucket', process.env);
  const stackName = envUtils.getRequiredEnvVar('stackName', process.env);
  const key = getS3KeyForArchivedMessages(stackName, messageId);
  try {
    await deleteS3Object(bucket, key);
    logger.info(`Deleted archived message ${messageId} from S3 at ${bucket}/${key}`);
  } catch (error) {
    logger.error(`Could not delete message from bucket. ${error}`);
    throw error;
  }
}
