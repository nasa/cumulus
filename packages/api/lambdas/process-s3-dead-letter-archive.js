'use strict';

const log = require('@cumulus/common/log');

const { s3 } = require('@cumulus/aws-client/services');
const { getJsonS3Object, deleteS3Object } = require('@cumulus/aws-client/S3');
const { getKnexClient } = require('@cumulus/db');
const { getMessageExecutionName } = require('@cumulus/message/Executions');

const { writeRecords } = require('./sf-event-sqs-to-db-records');

async function processDeadLetterArchive({
  knex,
  bucket = process.env.system_bucket,
  path = `${process.env.stackName}/dead-letter-archive/sqs/`,
  writeRecordsFunction = writeRecords,
}) {
  let listObjectsResponse;
  /* eslint-disable no-await-in-loop */
  do {
    listObjectsResponse = await s3().listObjectsV2({
      Bucket: bucket,
      Prefix: path,
    }).promise();
    const deadLetterObjects = listObjectsResponse.Contents;
    await Promise.allSettled(deadLetterObjects.map(
      async (deadLetterObject) => {
        const cumulusMessage = await getJsonS3Object(bucket, deadLetterObject.Key);
        try {
          await writeRecordsFunction({ cumulusMessage, knex });
          return deleteS3Object(bucket, deadLetterObject.Key);
        } catch (error) {
          const executionName = getMessageExecutionName(cumulusMessage);
          log.error(`Failed to write records from cumulusMessage for execution ${executionName}, reason: `, error);
          throw error;
        }
      }
    ));
  } while (listObjectsResponse.isTruncated);
  /* eslint-enable no-await-in-loop */
}

/**
 * Lambda handler for AsyncOperation purposes
 *
 * @param {Object} event - Input payload object
 * @param {string} [event.bucket] - Bucket containing dead letter archive (default to system bucket)
 * @param {string} [event.key] - Dead letter archive path key
 * @returns {Promise<undefined>}
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
  processDeadLetterArchive,
};
