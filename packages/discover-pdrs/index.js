'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const pdr = require('@cumulus/common/ingest/pdr');

function handler(event, context, cb) {
  let discover;
  const bucket = get(event, 'resources.buckets.internal');
  const provider = get(event, 'collection.provider', null);

  if (!provider) {
    const err = new ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  event.payload.pdrs = ['test2.PDR'];

  // discover files
  switch (provider.protocol) {
    case 'ftp': {
      discover = new pdr.FtpDiscover(provider, bucket);
      break;
    }
    default: {
      discover = new pdr.HttpDiscover(provider, bucket);
    }
  }

  discover.discover().then((pdrs) => {
    event.payload.pdrs = pdrs;
    return cb(null, event);
  }).catch(e => cb(e));
}

module.exports.handler = handler;
