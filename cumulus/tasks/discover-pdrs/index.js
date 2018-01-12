'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const pdr = require('@cumulus/ingest/pdr');
const errors = require('@cumulus/common/errors');
const logger = require('@cumulus/ingest/log');
const local = require('@cumulus/common/local-helpers');

const log = logger.child({ file: 'discover-pdrs/index.js' });

/**
* Callback function provided by aws lambda. See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html#nodejs-prog-model-handler-callback
*
* @callback lambdaCallback
* @param {object} error - error object
* @param {object} output - output object matching schemas/output.json
*/

/**
* Discover granules
* See schemas/input.json for detailed input schema
*
* @param {Object} event - Lambda event object
* @param {Object} event.config - configuration object for the task
* @param {string} event.config.stack - the name of the deployment stack
* @param {Object} event.config.provider - provider information
* @param {string} event.config.pdrFolder - folder for the PDRs
* @param {Object} event.config.buckets - S3 buckets
* @param {Object} event.config.collection - information about data collection related to task
* @param {boolean} [event.config.useQueue=true] - boolean to determine if task will queue granules.
* Default is `true`
* @param {Object} context - Lambda context object.
* See https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
* @param  {lambdaCallback} callback - Callback function provided by Lambda.
* @returns {undefined} - see schemas/output.json for detailed output schema
* that is passed to the next task in the workflow
**/
function handler(event, context, callback) {
  try {
    log.debug(event);
    const ev = Object.assign({}, event);
    const config = get(event, 'config');
    const queue = get(config, 'useQueue', true);
    const provider = get(config, 'provider', null);

    const output = {};

    log.child({ provider: get(provider, 'id') });

    if (!provider) {
      const err = new ProviderNotFound('Provider info not provided');
      log.error(err);
      return callback(err);
    }

    const Discover = pdr.selector('discover', provider.protocol, queue);
    const discover = new Discover(ev);

    log.debug('Starting PDR discovery');

    return discover.discover().then((pdrs) => {
      if (queue) {
        output.pdrs_found = pdrs.length;
      }
      else {
        output.pdrs = pdrs;
      }

      if (discover.connected) {
        discover.end();
        log.debug(`Ending ${provider.protocol} connection`);
      }

      return callback(null, output);
    }).catch((e) => {
      log.error(e);

      if (discover.connected) {
        discover.end();
        log.debug(`Ending ${provider.protocol} connection`);
      }

      if (e.toString().includes('ECONNREFUSED')) {
        const err = new errors.RemoteResourceError('Connection Refused');
        log.error(err);
        return callback(err);
      }
      else if (e.message.includes('Please login with USER and PASS')) {
        const err = new errors.FTPError('Login incorrect');
        log.error(err);
        return callback(err);
      }
      else if (e.details && e.details.status === 'timeout') {
        const err = new errors.ConnectionTimeout('connection Timed out');
        log.error(err);
        return callback(err);
      }
      else if (e.details && e.details.status === 'notfound') {
        const err = new errors.HostNotFound(`${e.details.url} not found`);
        log.error(err);
        return callback(err);
      }
      return callback(e);
    });
  }
  catch (e) {
    log.error(e);
    throw e;
  }
}

module.exports.handler = handler;

local.justLocalRun(() => {
  const filepath = process.argv[3] ? process.argv[3] : './tests/fixtures/input.json';
  const payload = require(filepath); // eslint-disable-line global-require

  payload.config.useQueue = false;
  handler(payload, {}, (e) => log.info(e));
});
