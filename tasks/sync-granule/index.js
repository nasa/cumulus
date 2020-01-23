'use strict';

const path = require('path');
const pMap = require('p-map');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const errors = require('@cumulus/errors');
const lock = require('@cumulus/ingest/lock');
const { duplicateHandlingType } = require('@cumulus/ingest/granule');
const log = require('@cumulus/common/log');
const GranuleFetcher = require('./GranuleFetcher');

/**
 * Ingest a list of granules
 *
 * @param {Object} ingest - an ingest object
 * @param {string} bucket - the name of an S3 bucket, used for locking
 * @param {string} provider - the name of a provider, used for locking
 * @param {Object[]} granules - the granules to be ingested
 * @returns {Promise<Array>} - the list of successfully ingested granules
 */
async function download(ingest, bucket, provider, granules) {
  log.debug(`awaiting lock.proceed in download() bucket: ${bucket}, `
            + `provider: ${JSON.stringify(provider)}, granuleID: ${granules[0].granuleId}`);
  const proceed = await lock.proceed(bucket, provider, granules[0].granuleId);

  if (!proceed) {
    const err = new errors.ResourcesLockedError('Download lock remained in place after multiple tries');
    log.error(err);
    throw err;
  }

  const ingestGranule = async (granule) => {
    try {
      const startTime = Date.now();
      const r = await ingest.ingest(granule, bucket);
      const endTime = Date.now();

      return {
        ...r,
        sync_granule_duration: endTime - startTime
      };
    } catch (e) {
      log.error(e);
      throw e;
    }
  };

  try {
    return await pMap(granules, ingestGranule, { concurrency: 1 });
  } finally {
    await lock.removeLock(bucket, provider.id, granules[0].granuleId);
  }
}

/**
 * Ingest a list of granules
 *
 * @param {Object} event - contains input and config parameters
 * @returns {Promise.<Object>} - a description of the ingested granules
 */
exports.syncGranule = function syncGranule(event) {
  const config = event.config;
  const input = event.input;
  const stack = config.stack;
  const buckets = config.buckets;
  const provider = config.provider;
  const collection = config.collection;
  const downloadBucket = config.downloadBucket;

  const duplicateHandling = duplicateHandlingType(event);

  // use stack and collection names to suffix fileStagingDir
  const fileStagingDir = path.join(
    (config.fileStagingDir || 'file-staging'),
    stack
  );

  if (!provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    log.error(err);
    return Promise.reject(err);
  }

  const ingest = new GranuleFetcher(
    buckets,
    collection,
    provider,
    fileStagingDir,
    duplicateHandling
  );

  return download(ingest, downloadBucket, provider, input.granules)
    .then((granules) => {
      const output = { granules };
      if (collection && collection.process) output.process = collection.process;
      if (config.pdr) output.pdr = config.pdr;
      log.debug(`SyncGranule Complete. Returning output: ${JSON.stringify(output)}`);
      return output;
    }).catch((e) => {
      log.debug('SyncGranule errored.');

      let errorToThrow = e;
      if (e.toString().includes('ECONNREFUSED')) {
        errorToThrow = new errors.RemoteResourceError('Connection Refused');
      } else if (e.details && e.details.status === 'timeout') {
        errorToThrow = new errors.ConnectionTimeout('connection Timed out');
      }

      log.error(errorToThrow);
      throw errorToThrow;
    });
};

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
exports.handler = function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(
    exports.syncGranule,
    event,
    context,
    callback
  );
};
