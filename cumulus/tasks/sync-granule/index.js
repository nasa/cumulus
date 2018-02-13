'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const errors = require('@cumulus/common/errors');
const lock = require('@cumulus/ingest/lock');
const granule = require('@cumulus/ingest/granule');
const log = require('@cumulus/common/log');

/**
 * Ingest a list of granules
 *
 * @param {Object} ingest - an ingest object
 * @param {string} bucket - the name of an S3 bucket, used for locking
 * @param {string} provider - the name of a provider, used for locking
 * @param {Object[]} granules - the granules to be ingested
 * @returns {Promise.<Array>} - the list of successfully ingested granules
 */
async function download(ingest, bucket, provider, granules) {
  const updatedGranules = [];

  const proceed = await lock.proceed(bucket, provider, granules[0].granuleId);

  if (!proceed) {
    const err = new errors.ResourcesLockedError(
      'Download lock remained in place after multiple tries'
    );
    log.error(err);
    throw err;
  }

  for (const g of granules) {
    try {
      const r = await ingest.ingest(g);
      updatedGranules.push(r);
    }
    catch (e) {
      await lock.removeLock(bucket, provider.id, g.granuleId);
      log.error(e);
      throw e;
    }
  }

  await lock.removeLock(bucket, provider.id, granules[0].granuleId);
  return updatedGranules;
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

  if (!config.provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    log.error(err);
    return Promise.reject(err);
  }

  const IngestClass = granule.selector('ingest', config.provider.protocol);
  const ingest = new IngestClass(event);

  return download(ingest, config.buckets.internal, config.provider, input.granules)
    .then((granules) => {
      if (ingest.end) ingest.end();

      const output = { granules };
      if (config.collection.process) output.process = config.collection.process;

      return output;
    }).catch((e) => {
      if (ingest.end) ingest.end();

      let errorToThrow = e;
      if (e.toString().includes('ECONNREFUSED')) {
        errorToThrow = new errors.RemoteResourceError('Connection Refused');
      }
      else if (e.details && e.details.status === 'timeout') {
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
  cumulusMessageAdapter.runCumulusTask(exports.syncGranule, event, context, callback);
};

// const { justLocalRun } = require('@cumulus/common/local-helpers');
// justLocalRun(() => {
//   const p = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');

//   process.env.EXECUTIONS = p.config.cumulus_meta.execution_name; //would be set in m adapter handler
//   process.env.SENDER = 'sync-granule'; //would be set in m adapter handler

//   exports.syncGranule(p).then(r => console.log(r));
// });
