'use strict';

const { OkResponse } = require('../lib/responses');
const pckg = require('../package.json');

/**
 * Returns the response and api versions.
 * This is intended as public endpoint that requires no authentication
 *
 * @function handler
 * @returns {type} HTTP response in json format
 */
async function handler() {
  return new OkResponse({
    json: true,
    body: {
      response_version: 'v1',
      api_version: pckg.version
    }
  });
}

module.exports = handler;
