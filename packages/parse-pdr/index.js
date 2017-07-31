'use strict';

import get from 'lodash.get';
import { ProviderNotFound } from '@cumulus/common/errors';
import { HttpParse, FtpParse } from '@cumulus/common/ingest/pdr';

export function handler(event, context, cb) {
  let parse;
  const pdrName = get(event, 'payload.pdrName');
  const bucket = get(event, 'resources.buckets.internal');
  const collections = get(event, 'meta.collections');
  const provider = get(event, 'collection.provider', null);
  const pdrPath = get(event, 'payload.pdrPath', '/');

  if (!provider) {
    const err = new ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  provider.path = pdrPath;

  // parse PDR
  switch (provider.protocol) {
    case 'ftp': {
      parse = new FtpParse(pdrName, provider, collections, bucket);
      break;
    }
    default: {
      parse = new HttpParse(pdrName, provider, collections, bucket);
    }
  }

  console.log(event);
  parse.ingest().then((granules) => {
    event.payload = granules;
    return cb(null, event);
  }).catch(e => cb(e));
}
