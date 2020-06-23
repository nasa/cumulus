'use strict';

const log = require('@cumulus/common/log');
const { inTestMode, throwTestError } = require('@cumulus/common/test-utils');

/**
 * Lambda function dumps the incoming event to a log
 * @param {Object} event - event object
 * @param {Object} logger - Cumulus common log object.  Can be overriden for testing.
 * @returns {Object} returns event object with data field deserialized
 */
async function kinesisEventLogger(event, logger = log) {
  const outputEvent = event;
  const outputRecords = event.Records.map((record) => {
    const updateRecord = record;
    updateRecord.kinesis.data = Buffer.from(record.kinesis.data, 'base64').toString('ascii');
    return updateRecord;
  });
  outputEvent.Records = outputRecords;
  outputRecords.forEach((record) => logger.info(JSON.stringify(record)));
  return outputEvent;
}

/**
 * Handler wrapper for kinesisEventLogger
 *
 * @param {Object} event object
 * @returns {void} returns nothing
 */
async function handler(event) {
  return kinesisEventLogger(event);
}
exports.handler = handler;
exports.kinesisEventLogger = inTestMode() ? kinesisEventLogger : throwTestError;
