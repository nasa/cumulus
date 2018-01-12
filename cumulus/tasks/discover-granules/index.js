'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const local = require('@cumulus/common/local-helpers');
const granule = require('@cumulus/ingest/granule');
const logger = require('@cumulus/ingest/log');

const log = logger.child({ file: 'discover-granules/index.js' });

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
* @param {Object} event.config.provider - provider information
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
    log.debug({ payload: event });
    const ev = Object.assign({}, event);
    const config = get(ev, 'config');

    const queue = get(config, 'useQueue', true);
    const provider = get(config, 'provider', null);

    if (!provider) {
      const err = new ProviderNotFound('Provider info not provided');
      log.error(err);
      return callback(err);
    }

    const Discover = granule.selector('discover', provider.protocol, queue);
    const discover = new Discover(ev);
    const output = {};

    log.debug('Staring granule discovery');
    return discover.discover().then((gs) => {
      if (queue) {
        output.granules_found = gs.length;
        log.debug(`Discovered ${gs.length} granules`);
      }
      else {
        log.debug(gs);
        output.granules = gs;
      }

      if (discover.connected) {
        discover.end();
        log.debug(`Ending ${provider.protocol} connection`);
      }
      return callback(null, output);
    }).catch((e) => {
      if (discover.connected) {
        discover.end();
      }
      log.error(e);
      callback(e);
    });
  }
  catch (e) {
    log.error(e);
    throw e;
  }
}

module.exports.handler = handler;

local.justLocalRun(() => {
  const filepath = process.argv[3] ? process.argv[3] : './tests/fixtures/mur.json';
  const payload = require(filepath); // eslint-disable-line global-require

  payload.config.useQueue = false;
  handler(payload, {}, (e) => log.info(e));
});
