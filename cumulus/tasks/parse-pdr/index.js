'use strict';

const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const pdr = require('@cumulus/ingest/pdr');

module.exports.handler = function handler(_event, context, cb) {
  const event = Object.assign({}, _event);
  const provider = get(event, 'provider', null);
  const queue = get(event, 'meta.useQueue', true);

  if (!provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  const Parse = pdr.selector('parse', provider.protocol, queue);
  const parse = new Parse(event);

  return parse.ingest().then((payload) => {
    if (parse.connected) {
      parse.end();
    }

    if (queue) {
      event.payload.granules_queued = payload.length
    }
    else {
      event.payload = Object.assign({}, event.payload, payload);
    }
    return cb(null, event);
  }).catch(e => {
    if (parse.connected) {
      parse.end();
    }

    if (e.toString().includes('ECONNREFUSED')) {
      return cb(new errors.RemoteResourceError('Connection Refused'));
    }
    else if (e.details && e.details.status === 'timeout') {
      return cb(new errors.ConnectionTimeout('connection Timed out'));
    }

    return cb(e);
  });
};
