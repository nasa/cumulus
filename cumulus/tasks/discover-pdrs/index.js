'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const pdr = require('@cumulus/ingest/pdr');
const errors = require('@cumulus/common/errors');
const logger = require('@cumulus/ingest/log');

const log = logger.child({ file: 'discover-pdrs/index.js' });

/**
 * Discover PDRs
 *
 * @param {Object} event - a simplified Cumulus event with input and config properties
 * @param {Object} _context - the AWS Lambda context, not used
 * @returns {Array.<Object>} - an array of objects describing PDRs
 */
function discoverPdrs(event, _context) {
  try {
    log.debug(event);
    const ev = Object.assign({}, event);
    const config = get(event, 'config');
    const queue = get(config, 'useQueue', true);
    const provider = get(config, 'provider', null);

    const output = {};

    if (!provider) throw new ProviderNotFound('Provider info not provided');

    log.child({ provider: get(provider, 'id') });

    const Discover = pdr.selector('discover', provider.protocol, queue);
    const discover = new Discover(ev);

    log.debug('Starting PDR discovery');

    return discover.discover()
      .then((pdrs) => {
        if (queue) output.pdrs_found = pdrs.length;
        else output.pdrs = pdrs;

        if (discover.connected) {
          log.debug(`Ending ${provider.protocol} connection`);
          discover.end();
        }

        return output;
      })
      .catch((e) => {
        log.error(e);

        if (discover.connected) {
          log.debug(`Ending ${provider.protocol} connection`);
          discover.end();
        }

        let errorToThrow = e;

        if (e.toString().includes('ECONNREFUSED')) {
          errorToThrow = new errors.RemoteResourceError('Connection Refused');
        }
        else if (e.message.includes('Please login with USER and PASS')) {
          errorToThrow = new errors.FTPError('Login incorrect');
        }
        else if (e.details && e.details.status === 'timeout') {
          errorToThrow = new errors.ConnectionTimeout('connection Timed out');
        }
        else if (e.details && e.details.status === 'notfound') {
          errorToThrow = new errors.HostNotFound(`${e.details.url} not found`);
        }

        throw errorToThrow;
      });
  }
  catch (err) {
    log.error(err);
    throw err;
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
