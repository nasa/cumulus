'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const pdr = require('@cumulus/ingest/pdr');
const errors = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const local = require('@cumulus/common/local-helpers');

/**
 * Discover PDRs
 *
 * @param {Object} event - a simplified Cumulus event with input and config properties
 * @returns {Promise.<Array>} - resolves to an array describing PDRs
 */
function discoverPdrs(event) {
  try {
    const config = get(event, 'config', {});
    const queue = get(config, 'useQueue', true);
    const stack = config.stack;
    const bucket = config.bucket;
    const queueUrl = config.queueUrl;
    const templateUri = config.templateUri;
    const collection = config.collection;
    const provider = config.provider;
    // FIXME Can config.folder not be used?

    const output = {};

    log.info('Received the provider', { provider: get(provider, 'id') });

    if (!provider) {
      const err = new ProviderNotFound('Provider info not provided');
      log.error(err);
      return Promise.reject(err);
    }

    const Discover = pdr.selector('discover', provider.protocol, queue);
    const discover = new Discover(
      stack,
      bucket,
      collection,
      provider,
      queueUrl,
      templateUri
    );

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

      return output;
    })
    .catch((e) => {
      log.error(e);

      if (discover.connected) {
        discover.end();
        log.debug(`Ending ${provider.protocol} connection`);
      }

      if (e.toString().includes('ECONNREFUSED')) {
        const err = new errors.RemoteResourceError('Connection Refused');
        log.error(err);
        throw err;
      }
      else if (e.message.includes('Please login with USER and PASS')) {
        const err = new errors.FTPError('Login incorrect');
        log.error(err);
        throw err;
      }
      else if (e.details && e.details.status === 'timeout') {
        const err = new errors.ConnectionTimeout('connection Timed out');
        log.error(err);
        throw err;
      }
      else if (e.details && e.details.status === 'notfound') {
        const err = new errors.HostNotFound(`${e.details.url} not found`);
        log.error(err);
        throw err;
      }

      throw e;
    });
  }
  catch (e) {
    log.error(e);
    throw e;
  }
}
exports.discoverPdrs = discoverPdrs; // exported to support testing

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(discoverPdrs, event, context, callback);
}
exports.handler = handler;

local.justLocalRun(() => {
  const filepath = process.argv[3] ? process.argv[3] : './tests/fixtures/input.json';
  const payload = require(filepath); // eslint-disable-line global-require

  payload.config.useQueue = false;
  cumulusMessageAdapter.runCumulusTask(discoverPdrs, payload, {}, (e) => log.info(e));
});
