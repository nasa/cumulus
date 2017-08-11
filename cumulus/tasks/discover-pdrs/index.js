'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const pdr = require('@cumulus/ingest/pdr');
const errors = require('@cumulus/common/errors');

function handler(_event, context, cb) {
  let discover;
  const event = Object.assign({}, _event);
  const bucket = get(event, 'resources.buckets.internal');
  const provider = get(event, 'provider', null);
  const folder = get(event, 'meta.pdrsFolder', 'pdrs');
  const discoverLimit = get(event, 'meta.discoverLimit', 100);

  if (!provider) {
    const err = new ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  // discover files
  switch (provider.protocol) {
    case 'ftp': {
      discover = new pdr.FtpDiscoverAndQueue(event);
      break;
    }
    default: {
      discover = new pdr.HttpDiscoverAndQueue(event);
    }
  }

  return discover.discover().then((pdrs) => {
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
