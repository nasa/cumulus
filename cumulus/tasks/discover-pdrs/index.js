'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const pdr = require('@cumulus/ingest/pdr');
const errors = require('@cumulus/common/errors');

function handler(_event, context, cb) {
  const event = Object.assign({}, _event);
  const queue = get(event, 'meta.useQueue', true);
  const provider = get(event, 'provider', null);

  // this is used to override where PDRs are saved
  const folder = get(event, 'meta.pdrsFolder', 'pdrs');

  if (!provider) {
    const err = new ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  const Discover = granule.selector('discover', provider.protocol, queue);
  const discover = new Discover(event);

  return discover.discover().then((pdrs) => {
    if (queue) {
      event.payload.granules_found = gs.length;
    }
    else {
      event.payload.granules = gs;
    }


    event.payload.pdrs = pdrs.slice(0, 10);
    return cb(null, event);
  }).catch(e => {
    if (e.details && e.details.status === 'timeout') {
      cb(new errors.ConnectionTimeout('connection Timed out'));
    }
    else if (e.details && e.details.status === 'notfound') {
      cb(new errors.HostNotFound(`${e.details.url} not found`));
    }
    else {
      cb(e);
    }
  });
}

module.exports.handler = handler;
