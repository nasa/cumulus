'use strict';

const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const pdr = require('@cumulus/ingest/pdr');
const log = require('@cumulus/ingest/log');

/**
* Callback function provided by aws lambda. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html#nodejs-prog-model-handler-callback
*
* @callback lambdaCallback
* @param {object} error - error object
* @param {object} output - output object matching schemas/output.json
*/

/**
* Parse a PDR
* See schemas/input.json for detailed input schema
*
* @param {Object} event - Lambda event object
* @param {Object} event.config - configuration object for the task
* @param {string} event.config.stack - the name of the deployment stack
* @param {string} event.config.pdrFolder - folder for the PDRs
* @param {Object} event.config.provider - provider information
* @param {Object} event.config.buckets - S3 buckets
* @param {Object} event.config.collection - information about data collection related to task
* @param {Object} context - Lambda context object.
* See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
* @param  {lambdaCallback} callback - Callback function provided by Lambda.
* @returns {undefined} see schemas/output.json for detailed output schema
* that is passed to the next task in the workflow
**/
module.exports.handler = function handler(event, context, callback) {
  const config = get(event, 'config');
  const provider = get(config, 'provider', null);
  const queue = get(config, 'useQueue', true);

  if (!provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    log.error(err);
    return callback(err);
  }

  const Parse = pdr.selector('parse', provider.protocol, queue);
  const parse = new Parse(event);

  return parse.ingest()
    .then((payload) => {
      if (parse.connected) {
        parse.end();
      }

      const output = Object.assign({}, event.input, payload);
      callback(null, output);
    })
    .catch((e) => {
      if (e.toString().includes('ECONNREFUSED')) {
        const err = new errors.RemoteResourceError('Connection Refused');
        log.error(err);
        return callback(err);
      }
      else if (e.details && e.details.status === 'timeout') {
        const err = new errors.ConnectionTimeout('connection Timed out');
        log.error(err);
        return callback(err);
      }

      log.error(e);
      return callback(e);
    });
};
