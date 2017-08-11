'use strict';

const get = require('lodash.get');
const ProviderNotFound = require('@cumulus/common/errors').ProviderNotFound;
const granule = require('@cumulus/ingest/granule');

function handler(_event, context, cb) {
  let discover;
  const event = Object.assign({}, _event);
  const provider = get(event, 'provider', null);

  if (!provider) {
    const err = new ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  // discover files
  switch (provider.protocol) {
    case 'sftp': {
      discover = new granule.SftpDiscoverAndQueueGranules(event);
      break;
    }
    default: {
      throw new Error('not supported yet. Only works with SFTP');
    }
  }

  return discover.discover().then((gs) => {
    event.payload.granules_found = gs.length;
    discover._end();
    return cb(null, event);
  }).catch(e => {
    discover._end();
    return cb(e);
  });
}

module.exports.handler = handler;

