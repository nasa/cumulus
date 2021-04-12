'use strict';

const log = require('@cumulus/common/log');

const { getJsonS3Object, listS3ObjectsV2, deleteS3Object } = require('@cumulus/aws-client/S3');
const { getKnexClient } = require('@cumulus/db');
const { getMessageExecutionName } = require('@cumulus/message/Executions');

const { writeRecords } = require('./sf-event-sqs-to-db-records');

async function processDeadLetterArchive({
  knex,
  bucket = process.env.system_bucket,
  path = `${process.env.stackName}/dead-letter-archive/sqs/`,
  writeRecordsFunction = writeRecords,
}) {
  // TODO: figure out a way to cap this so we don't read a billion objects into memory
  const deadLetterObjects = await listS3ObjectsV2({
    Bucket: bucket,
    Prefix: path,
  });
  return Promise.allSettled(deadLetterObjects.map(
    async (deadLetterObject) => {
      const cumulusMessage = await getJsonS3Object(bucket, deadLetterObject.Key);
      try {
        await writeRecordsFunction({ cumulusMessage, knex });
        return deleteS3Object(bucket, deadLetterObject.Key);
      } catch (err) {
        const executionName = getMessageExecutionName(cumulusMessage);
        log.error(`Failed to write records from cumulusMessage for execution ${executionName}, reason: `, err);
        throw err;
      }
    }
  ));
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
