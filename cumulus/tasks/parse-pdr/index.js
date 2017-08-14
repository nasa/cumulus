'use strict';

const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const pdr = require('@cumulus/ingest/pdr');

module.exports.handler = function handler(_event, context, cb) {
  let parse;
  const event = Object.assign({}, _event);
  const pdrName = get(event, 'payload.pdrName');
  const bucket = get(event, 'resources.buckets.internal');
  const collections = get(event, 'meta.collections');
  const provider = get(event, 'provider', null);
  const pdrPath = get(event, 'payload.pdrPath', '/');
  const folder = get(event, 'meta.pdrsFolder', 'pdrs');

  if (!provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  provider.path = pdrPath;

  // parse PDR
  switch (provider.protocol) {
    case 'ftp': {
      parse = new pdr.FtpParse(pdrName, provider, collections, bucket, folder);
      break;
    }
    default: {
      parse = new pdr.HttpParse(pdrName, provider, collections, bucket, folder);
    }
  }

  return parse.ingest().then((granules) => {
    event.payload = granules;
    return cb(null, event);
  }).catch(e => cb(e));
};
