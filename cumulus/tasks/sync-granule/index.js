'use strict';

const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const lock = require('@cumulus/common/ingest/lock');
const granule = require('@cumulus/common/ingest/granule');

async function download(buckets, provider, g, collections) {
  let IngestClass;
  const granuleId = g.granuleId;
  const proceed = await lock.proceed(buckets.internal, provider, granuleId);

  // parse PDR
  switch (provider.protocol) {
    case 'ftp': {
      IngestClass = granule.FtpGranule;
      break;
    }
    default: {
      IngestClass = granule.HttpGranule;
    }
  }

  if (!proceed) {
    throw new Error('Download lock remained in place after multiple tries');
  }

  const collection = collections[g.collectionName];
  const ingest = new IngestClass(g, provider, collection, buckets);

  const r = await ingest.ingest();
  await lock.removeLock(buckets.internal, provider.id, granuleId);

  return r;
}

module.exports.handler = function handler(_event, context, cb) {
  const event = Object.assign({}, _event);
  const buckets = get(event, 'resources.buckets');
  const collections = get(event, 'meta.collections');
  const provider = get(event, 'provider', null);
  const granules = get(event, 'payload.granules');

  if (!provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    return cb(err);
  }

  let ad = [];

  // download all the granules provided
  ad = granules.map((g) => download(buckets, provider, g, collections));
  const updatedInput = {};

  return Promise.all(ad).then((r) => {
    r.forEach((g) => {
      const granuleObject = {
        granuleId: g.granuleId,
        files: g.files
      };
      if (updatedInput[g.collectionName]) {
        updatedInput[g.collectionName].granules.push(granuleObject);
      }
      else {
        updatedInput[g.collectionName] = {
          granules: [granuleObject]
        };
      }
    });
    event.payload = { input: updatedInput };
    return cb(null, event);
  }).catch(e => cb(e));
};
