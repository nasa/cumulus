'use strict';

const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const lock = require('@cumulus/ingest/lock');
const granule = require('@cumulus/ingest/granule');

async function download(buckets, provider, g, collections) {
  let IngestClass;
  let r;
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
    throw new errors.ResourcesLockedError('Download lock remained in place after multiple tries');
  }

  try {
    const collection = collections[g.collection];
    const ingest = new IngestClass(g, provider, collection, buckets);

    r = await ingest.ingest();
  }
  catch (e) {
    await lock.removeLock(buckets.internal, provider.id, granuleId);
    throw e;
  }

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
    let collectionName;
    r.forEach((g) => {
      const granuleObject = {
        granuleId: g.granuleId,
        files: g.files
      };
      collectionName = g.collectionName;
      if (updatedInput[g.collectionName]) {
        updatedInput[g.collectionName].granules.push(granuleObject);
      }
      else {
        updatedInput[g.collectionName] = {
          granules: [granuleObject]
        };
      }
    });
    event.meta.process = collections[collectionName].process;
    event.payload = {
      input: updatedInput,
      output: {
        [collectionName]: {
          granules: []
        }
      }
    };
    return cb(null, event);
  }).catch(e => cb(e));

  //const updatedPayload = [];

  //return Promise.all(ad).then((r) => {
    //for (const g of r) {
      //for (const og of granules) {
        //if (og.granuleId === g.granuleId) {
          //og.files = g.files;
          //updatedPayload.push(og);
          //break;
        //}
      //}
    //}

    //event.payload = { granules: updatedPayload };
    //return cb(null, event);
  //}).catch(e => cb(e));
};

