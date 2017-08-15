'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const pdr = require('@cumulus/ingest/pdr');
const errors = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const local = require('@cumulus/common/local-helpers');

function handler(_event, context, cb) {
  const event = Object.assign({}, _event);
  const queue = get(event, 'meta.useQueue', true);
  const provider = get(event, 'provider', null);

  if (!provider) {
    const err = new ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  const Discover = pdr.selector('discover', provider.protocol, queue);
  const discover = new Discover(event);

  return discover.discover().then((pdrs) => {
    if (queue) {
      event.payload.pdrs_found = pdrs.length;
    }
    else {
      event.payload.pdrs = pdrs;
    }

    if (discover.connected) {
      discover.end();
    }

    return cb(null, event);
  }).catch(e => {
    log.error(e);

    if (discover.connected) {
      discover.end();
    }

    if (e.toString().includes('ECONNREFUSED')) {
      return cb(new errors.RemoteResourceError('Connection Refused'));
    }
    else if (e.details && e.details.status === 'timeout') {
      return cb(new errors.ConnectionTimeout('connection Timed out'));
    }
    else if (e.details && e.details.status === 'notfound') {
      return cb(new errors.HostNotFound(`${e.details.url} not found`));
    }
    return cb(e);
  });
}

module.exports.handler = handler;

local.justLocalRun(() => {
  const payload = require( // eslint-disable-line global-require
    '@cumulus/test-data/payloads/modis/discover.json'
  );
  payload.meta.useQueue = false;
  handler(payload, {}, (e, r) => console.log(e, r));
});
