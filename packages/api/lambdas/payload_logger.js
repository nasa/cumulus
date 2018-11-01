'use strict';

const { log } = require('@cumulus/common');

/**
 * Lambda function dumps the incoming event to a log
 * @param {} event
 * @returns {void} returns nothing
 */
async function handler(event) {
  log.info(event);
}

exports.handler = handler;
