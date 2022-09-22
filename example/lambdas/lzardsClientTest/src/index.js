'use strict';

const { submitQueryToLzards } = require('@cumulus/lzards-api-client/lzards');
const Logger = require('@cumulus/logger');

const log = new Logger({ sender: 'lzardsClientTest' });

/**
 * Receives event trigger from integration tests and calls lzards api wrapper.
 *
 * @param {Object} event - from integration test
 * @returns {Promise} confirmation of test pass or failure
 */
async function handler(event) {
  const response = await submitQueryToLzards({ searchParams: event.searchParams });

  log.debug(`Response from lzards API: ${JSON.stringify(response.body)}`);

  return response.body;
}

module.exports = {
  handler,
};
