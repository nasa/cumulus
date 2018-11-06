'use strict';

const { log } = require('@cumulus/common');
const { inTestMode, throwTestError } = require('@cumulus/common/test-utils');

/**
 * Lambda function dumps the incoming event to a log
 * @param {Object} lambda event object
 * @param {Object} Cumulus common log object.  Can be overriden for testing.
 * @returns {Object} returns event object with data field deserialized
 */
async function kinesisEventLogger(event, logger=log) {
  let outputEvent = event;
  let outputRecords = event.Records.map((record) => {
    record.kinesis.data = Buffer.from(record.kinesis.data, 'base64').toString('ascii');
    return record;
  });
  outputEvent.Records = outputRecords;
  logger.info(JSON.stringify(outputEvent));
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
