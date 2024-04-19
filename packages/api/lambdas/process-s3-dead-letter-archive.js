'use strict';

//@ts-check
const log = require('@cumulus/common/log');

const S3 = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { getJsonS3Object, deleteS3Object } = require('@cumulus/aws-client/S3');
const { getKnexClient } = require('@cumulus/db');
const { unwrapDeadLetterCumulusMessage } = require('@cumulus/message/DeadLetterMessage');

const { writeRecords } = require('./sf-event-sqs-to-db-records');

/**
 * Generates new archive key for unprocessed dead letter message
 *
 * @param {string}   [failedKey] - key of message that failed to process
 * @returns {string}
 */
const generateNewArchiveKeyForFailedMessage = (failedKey) => {
  if (failedKey.includes('sqs/')) {
    /* this is the expected path
    * this *should* be called with format
    * `${process.env.stackName}/dead-letter-archive/sqs/${messageId}`
    * this path will also handle a call pointed to
    * `${process.env.stackName}/dead-letter-archive/failed-sqs/${messageId}`
    * */
    return failedKey.replace('sqs/', 'failed-sqs/');
  }
  if (failedKey.includes('dead-letter-archive/')) {
    // in case a weird path is passed, hopefully it contains dead-letter-archive/
    return failedKey.replace('failed-dead-letter-archive/');
  }

  // catchall to avoid data loss in case of failure
  return failedKey.replace(process.env.stackName, `${process.env.stackName}/failed-dead-letter-archive`);
};

/**
 * Transfers unprocessed dead letters in the bucket to new location
 * and deletes dead letters from old archive path
 *
 * @param {string}   [deadLetterObject] - unprocessed dead letter object
 * @param {string}   [bucket] - S3 bucket
 * @returns {Promise<void>}
 */
const transferUnprocessedMessage = async (deadLetterObject, bucket) => {
  // Save allFailedKeys messages to different location
  const s3KeyForFailedMessage = generateNewArchiveKeyForFailedMessage(deadLetterObject.Key);
  try {
    log.info(`Attempting to save messages that failed to process to ${bucket}/${s3KeyForFailedMessage}`);
    await S3.s3CopyObject({
      Bucket: bucket,
      Key: s3KeyForFailedMessage,
      CopySource: `${bucket}/${deadLetterObject.Key}`,
    });
    log.info(`Saved message to S3 s3://${bucket}/${s3KeyForFailedMessage}`);

    // Delete failed key from old path
    await deleteS3Object(bucket, deadLetterObject.Key);
    log.info(`Deleted archived dead letter message from S3 at ${bucket}/${deadLetterObject.Key}`);
  } catch (error) {
    log.error(`Failed to transfer S3 Object s3://${bucket}/${deadLetterObject.Key} due to error: ${error}`);
    throw error;
  }
};

/**
 * Process dead letters in the bucket dead letter archive
 * and attempt to write records to the Cumulus DB
 *
 * @param {Object}   params - Parameters object
 * @param {Knex}     params.knex - Client to interact with Postgres database
 * @param {string}   [params.bucket] - optional bucket override
 * @param {string}   [params.path] - optional dead letter archive path override
 * @param {Function} [params.writeRecordsFunction] - optional function override for testing
 * @param {number}   [params.batchSize] - optional S3 results batch size override for testing
 * @returns {Promise<void>}
 */
async function processDeadLetterArchive({
  knex,
  bucket = process.env.system_bucket,
  path = `${process.env.stackName}/dead-letter-archive/sqs/`,
  writeRecordsFunction = writeRecords,
  batchSize = 1000,
}) {
  let listObjectsResponse;
  let continuationToken;
  let allSuccessKeys = [];
  const allFailedKeys = [];
  /* eslint-disable no-await-in-loop */
  do {
    listObjectsResponse = await s3().listObjectsV2({
      Bucket: bucket,
      Prefix: path,
      ContinuationToken: continuationToken,
      MaxKeys: batchSize,
    });
    continuationToken = listObjectsResponse.NextContinuationToken;
    const deadLetterObjects = listObjectsResponse.Contents || [];
    const promises = await Promise.allSettled(deadLetterObjects.map(
      async (deadLetterObject) => {
        const deadLetterMessage = await getJsonS3Object(bucket, deadLetterObject.Key);
        const cumulusMessage = await unwrapDeadLetterCumulusMessage(deadLetterMessage);
        try {
          await writeRecordsFunction({ cumulusMessage, knex });
          return deadLetterObject.Key;
        } catch (error) {
          log.error(`Failed to write records from cumulusMessage for dead letter ${deadLetterObject.Key} due to '${error}'`);
          allFailedKeys.push(deadLetterObject.Key);
          log.info('Transferring unprocessed message to new archive location');
          await transferUnprocessedMessage(deadLetterObject, bucket);
          throw error;
        }
      }
    ));

    const successfullyProcessedKeys = promises.filter(
      (prom) => prom.status === 'fulfilled'
    ).map((prom) => prom.value);
    allSuccessKeys = allSuccessKeys.concat(successfullyProcessedKeys);

    const keysToDelete = successfullyProcessedKeys.map((key) => ({ Key: key }));
    if (keysToDelete.length > 0) {
      await s3().deleteObjects({
        Bucket: bucket,
        Delete: {
          Objects: keysToDelete,
        },
      });
    }
  } while (listObjectsResponse.IsTruncated);
  /* eslint-enable no-await-in-loop */
  // Lambda run as an async operation must have a return
  return {
    processingSucceededKeys: allSuccessKeys,
    processingFailedKeys: allFailedKeys,
  };
}

/**
 * Lambda handler for AsyncOperation purposes
 *
 * @param {Object} event - Input payload object
 * @param {string} [event.bucket] - Bucket containing dead letter archive (default to system bucket)
 * @param {string} [event.key] - Dead letter archive path key
 * @returns {Promise<void>}
 */
async function handler(event) {
  const knex = await getKnexClient({
    env: {
      ...process.env,
      ...event.env,
    },
  });
  const {
    bucket,
    path,
  } = event;
  return processDeadLetterArchive({ knex, bucket, path });
}

module.exports = {
  handler,
  generateNewArchiveKeyForFailedMessage,
  processDeadLetterArchive,
};
