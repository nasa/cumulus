'use strict';

const { buildLambdaProxyResponse } = require('../lib/response');
const pckg = require('../package.json');


/**
 * Returns the response and api versions.
 * This is intended as public endpoint that requires no authentication
 *
 * @function handler
 * @param  {type} event - aws lambda function event
 * @param  {type} context - aws lambda funciton context
 * @returns {type} Http response in json format
 */
function handler(event, context) {
  const response = {
    response_version: 'v1',
    api_version: pckg.version
  };
  return buildLambdaProxyResponse({body: response});
}

module.exports = handler;
