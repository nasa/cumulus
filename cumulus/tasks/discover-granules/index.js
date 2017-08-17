'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const local = require('@cumulus/common/local-helpers');
const granule = require('@cumulus/ingest/granule');

function handler(_event, context, cb) {
  const event = Object.assign({}, _event);
  const queue = get(event, 'meta.useQueue', true);
  const provider = get(event, 'provider', null);

  if (!provider) {
    const err = new ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  const Discover = granule.selector('discover', provider.protocol, queue);
  const discover = new Discover(event);

  return discover.discover().then((gs) => {
    if (queue) {
      event.payload.granules_found = gs.length;
    }
    else {
      event.payload.granules = gs;
    }

    if (discover.connected) {
      discover.end();
    }
    return cb(null, event);
  }).catch(e => {
    if (discover.connected) {
      discover.end();
    }
    cb(e);
  });
}

module.exports.handler = handler;

local.justLocalRun(() => {
  const payload = require( // eslint-disable-line global-require
    '@cumulus/test-data/payloads/mur/discover.json'
  );
  payload.meta.useQueue = false;
  handler(payload, {}, (e, r) => console.log(e, r));
});
