//@ts-check

'use strict';

const pMap = require('p-map');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const errors = require('@cumulus/errors');
const lock = require('@cumulus/ingest/lock');
const { duplicateHandlingType } = require('@cumulus/ingest/granule');
const { s3Join } = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const GranuleFetcher = require('./GranuleFetcher');

/**
 * @typedef {import ('./index-types').SyncGranulePDR } SyncGranulePDR
 * @typedef {import ('./index-types').SyncGranuleConfig } SyncGranuleConfig
 */

/**
 * Ingest a list of granules
 *
 * @param {Object} kwargs - keyword arguments
 * @param {Object} kwargs.ingest - an ingest object
 * @param {string} kwargs.bucket - the name of an S3 bucket, used for locking
 * @param {Object} kwargs.provider - The provider object as defined in the
 * task schema
 * @param {Object[]} kwargs.granules - the granules to be ingested
 * @param {boolean} [kwargs.syncChecksumFiles=false] - if `true`, also ingest
 *    all corresponding checksum files
 * @param {boolean} [kwargs.useGranIdPath=true] - if 'true', use a md5 hash of the
 * granuleID in the object prefix staging location
 * @returns {Promise<Array>} the list of successfully ingested granules, or an
 *    empty list if the input granules was not a non-empty array of granules
 */
async function download({
  ingest,
  bucket,
  provider,
  granules,
  syncChecksumFiles = false,
  useGranIdPath = true,
}) {
  if (!Array.isArray(granules) || granules.length === 0) return [];

  log.debug(
    'awaiting lock.proceed in download() '
    + `bucket: ${bucket}, `
    + `provider: ${JSON.stringify(provider)}, `
    + `granuleID: ${granules[0].granuleId}, `
  );

  const proceed = await lock.proceed(bucket, provider, granules[0].granuleId);

  if (!proceed) {
    const err = new errors.ResourcesLockedError(
      'Download lock remained in place after multiple tries'
    );
    log.error(err);
    throw err;
  }

  const ingestGranule = async (granule) => {
    try {
      const startTime = Date.now();
      const { ingestedGranule, granuleDuplicateFiles } = await ingest.ingest({
        granule,
        bucket,
        syncChecksumFiles,
        useGranIdPath,
      });
      const endTime = Date.now();

      return {
        ingestedGranule: {
          ...ingestedGranule,
          sync_granule_duration: endTime - startTime,
        },
        granuleDuplicateFiles,
      };
    } catch (error) {
      log.error(error);
      throw error;
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
 * @param {SyncGranuleConfig} event.config - the task configuration object
 * @param {Object} event.input - the input object
 * @returns {Promise.<Object>} - a description of the ingested granules
 */
function syncGranule(event) {
  const now = Date.now();
  const { config, input } = event;
  const {
    stack,
    buckets,
    provider,
    collection,
    downloadBucket,
    useGranIdPath,
    syncChecksumFiles,
    workflowStartTime: configWorkflowStartTime,
  } = config;

  const duplicateHandling = duplicateHandlingType(event);
  const workflowStartTime = configWorkflowStartTime ? Math.min(configWorkflowStartTime, now) : now;

  // use stack and collection names to suffix fileStagingDir
  const fileStagingDir = s3Join(
    (config.fileStagingDir || 'file-staging'),
    (stack || '')
  );

  if (!provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    log.error(err);
    return Promise.reject(err);
  }

  const ingest = new GranuleFetcher({
    buckets,
    collection,
    provider,
    fileStagingDir,
    duplicateHandling,
  });

  return download({
    bucket: downloadBucket,
    granules: input.granules,
    ingest,
    provider,
    syncChecksumFiles,
    useGranIdPath,
  }).then((granuleResults) => {
    // eslint-disable-next-line camelcase
    const granuleDuplicates = {};
    const granules = [];
    granuleResults.forEach((gr) => {
      if (!gr.ingestedGranule.createdAt) {
        const granule = gr;
        granule.ingestedGranule.createdAt = workflowStartTime;
      }
      granules.push(gr.ingestedGranule);
      if (gr.granuleDuplicateFiles) {
        granuleDuplicates[gr.granuleDuplicateFiles.granuleId] = {
          files: gr.granuleDuplicateFiles.files,
        };
      }
    });
    const output = { granules, granuleDuplicates };
    if (collection && collection.process) output.process = collection.process;
    if (config.pdr) output.pdr = config.pdr;
    log.debug(`SyncGranule Complete. Returning output: ${JSON.stringify(output)}`);
    return output;
  }).catch((error) => {
    log.debug('SyncGranule errored.');

    let errorToThrow = error;
    if (error.toString().includes('ECONNREFUSED')) {
      errorToThrow = new errors.RemoteResourceError('Connection Refused');
    } else if (error.details && error.details.status === 'timeout') {
      errorToThrow = new errors.ConnectionTimeout('Connection Timed Out');
    }

    log.error(errorToThrow);
    throw errorToThrow;
  });
}

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(
    syncGranule,
    event,
    context
  );
}

module.exports = {
  handler,
  syncGranule,
};
