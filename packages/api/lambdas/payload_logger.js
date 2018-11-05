'use strict';

const { log } = require('@cumulus/common');

/**
 * Lambda function dumps the incoming event to a log
 * @param {} event
 * @returns {void} returns nothing
 */
async function handler(event) {
  let outputEvent = event;
  let outputRecords = event.Records.map((record) => {
    record.kinesis.data = Buffer.from(record.kinesis.data, 'base64').toString('ascii');
    return record;
  });
  outputEvent.Records = outputRecords;
  log.info(JSON.stringify(outputEvent));
}



exports.handler = handler;
