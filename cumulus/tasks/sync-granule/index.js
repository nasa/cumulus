'use strict';

const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const lock = require('@cumulus/ingest/lock');
const granule = require('@cumulus/ingest/granule');
const logger = require('@cumulus/ingest/log');

const log = logger.child({ file: 'sync-granule/index.js' });

async function download(ingest, bucket, provider, g) {
  let r;
  const proceed = await lock.proceed(bucket, provider, g.granuleId);

  if (!proceed) {
    const err = new errors.ResourcesLockedError(
      'Download lock remained in place after multiple tries'
    );
    log.error(err);
    throw err;
  }

  try {
    r = await ingest.ingest(g);
  }
  catch (e) {
    await lock.removeLock(bucket, provider.id, g.granuleId);
    log.error(e);
    throw e;
  }

  await lock.removeLock(bucket, provider.id, g.granuleId);
  return r;
}

module.exports.handler = function handler(_event, context, cb) {
  try {
    const event = Object.assign({}, _event);
    const buckets = get(event, 'resources.buckets');
    const collection = get(event, 'collection.meta');
    const granules = get(event, 'payload.granules');
    const provider = get(event, 'provider');

    if (!provider) {
      const err = new errors.ProviderNotFound('Provider info not provided');
      log.error(err);
      return cb(err);
    }

    const IngestClass = granule.selector('ingest', provider.protocol);
    const ingest = new IngestClass(event);

    let ad = [];

    // download all the granules provided
    ad = granules.map((g) => download(ingest, buckets.internal, provider, g));

    return Promise.all(ad).then((gs) => {
      event.payload.granules = gs;

      if (collection.process) {
        event.meta.process = collection.process;
      }

      if (ingest.connected) {
        ingest.end();
      }

      return cb(null, event);
    }).catch(e => {
      if (ingest.connected) {
        ingest.end();
      }

      if (e.toString().includes('ECONNREFUSED')) {
        const err = new errors.RemoteResourceError('Connection Refused');
        log.error(err);
        return cb(err);
      }
      else if (e.details && e.details.status === 'timeout') {
        const err = new errors.ConnectionTimeout('connection Timed out');
        log.error(err);
        return cb(err);
      }

      log.error(e);
      return cb(e);
    });
  }
  catch (e) {
    log.error(e);
    throw e;
  }
};
