'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash.get');
const pdr = require('@cumulus/ingest/pdr');
const errors = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');

/**
 * Discover PDRs
 *
 * @param {Object} event - a simplified Cumulus event with input and config properties
 * @returns {Promise.<Array>} - resolves to an array describing PDRs
 */
function discoverPdrs(event) {
  try {
    const config = get(event, 'config', {});
    const stack = config.stack;
    const bucket = config.bucket;
    const collection = config.collection;
    const provider = config.provider;
    const providerPath = config.provider_path || collection.provider_path;
    const filterPdrs = config.filterPdrs || null;

    // FIXME Can config.folder not be used?

    log.info('Received the provider', { provider: get(provider, 'id') });

    const Discover = pdr.selector('discover', provider.protocol);
    const discover = new Discover(
      stack,
      bucket,
      providerPath,
      provider,
      config.useList,
      'pdrs',
      config.force || false
    );

    log.debug('Starting PDR discovery');

    return discover.discover()
      .then((pdrs) => {
        if (discover.connected) discover.end();

        // filter pdrs using filterPDrs
        if (filterPdrs && pdrs.length > 0) {
          log.info(`Filtering ${pdrs.length} with ${filterPdrs}`);
          const fpdrs = pdrs.filter((p) => p.name.match(filterPdrs));
          return { pdrs: fpdrs };
        }

        return { pdrs };
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
        } else if (e.message.includes('Please login with USER and PASS')) {
          const err = new errors.FTPError('Login incorrect');
          log.error(err);
          throw err;
        } else if (e.details && e.details.status === 'timeout') {
          const err = new errors.ConnectionTimeout('connection Timed out');
          log.error(err);
          throw err;
        } else if (e.details && e.details.status === 'notfound') {
          const err = new errors.HostNotFound(`${e.details.url} not found`);
          log.error(err);
          throw err;
        }

        throw e;
      });
  } catch (e) {
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
