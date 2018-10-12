'use strict';

const { buildLambdaProxyResponse } = require('../lib/response');
const pckg = require('../package.json');

/**
 * Returns the response and api versions.
 * This is intended as public endpoint that requires no authentication
 *
 * @function handler
 * @returns {type} HTTP response in json format
 */
function handler() {
  const response = {
    response_version: 'v1',
    api_version: pckg.version
  };
  return buildLambdaProxyResponse({ body: response });
}

module.exports = handler;
