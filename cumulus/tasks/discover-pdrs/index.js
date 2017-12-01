'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const pdr = require('@cumulus/ingest/pdr');
const errors = require('@cumulus/common/errors');
const logger = require('@cumulus/ingest/log');
const local = require('@cumulus/common/local-helpers');

const log = logger.child({ file: 'discover-pdrs/index.js' });

function handler(_event, context, cb) {
  try {
    log.debug(_event);
    const event = Object.assign({}, _event);
    const config = get(event, 'config');
    const queue = get(config, 'useQueue', true);
    const provider = get(config, 'provider', null);

    const output = {};

    log.child({ provider: get(provider, 'id') });

    if (!provider) {
      const err = new ProviderNotFound('Provider info not provided');
      log.error(err);
      return cb(err);
    }

    const Discover = pdr.selector('discover', provider.protocol, queue);
    const discover = new Discover(event);

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

      return cb(null, output);
    }).catch(e => {
      log.error(e);

      if (discover.connected) {
        discover.end();
        log.debug(`Ending ${provider.protocol} connection`);
      }

      if (e.toString().includes('ECONNREFUSED')) {
        const err = new errors.RemoteResourceError('Connection Refused');
        log.error(err);
        return cb(err);
      }
      else if (e.message.includes('Please login with USER and PASS')) {
        const err = new errors.FTPError('Login incorrect');
        log.error(err);
        return cb(err);
      }
      else if (e.details && e.details.status === 'timeout') {
        const err = new errors.ConnectionTimeout('connection Timed out');
        log.error(err);
        return cb(err);
      }
      else if (e.details && e.details.status === 'notfound') {
        const err = new errors.HostNotFound(`${e.details.url} not found`);
        log.error(err);
        return cb(err);
      }
      return cb(e);
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
