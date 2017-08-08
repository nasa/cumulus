'use strict';

const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const pdr = require('@cumulus/common/ingest/pdr');

module.exports.handler = function handler(_event, context, cb) {
  let parse;
  const event = Object.assign({}, _event);
  const pdrName = get(event, 'payload.pdrName');
  const bucket = get(event, 'resources.buckets.internal');
  const collections = get(event, 'meta.collections');
  const provider = get(event, 'provider', null);
  const pdrPath = get(event, 'payload.pdrPath', '/');

  if (!provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  provider.path = pdrPath;

  // parse PDR
  switch (provider.protocol) {
    case 'ftp': {
      parse = new pdr.FtpParse(pdrName, provider, collections, bucket);
      break;
    }
    default: {
      parse = new pdr.HttpParse(pdrName, provider, collections, bucket);
    }
  }

  return parse.ingest().then((granules) => {
    event.payload = granules;
    return cb(null, event);
  }).catch(e => cb(e));
};
