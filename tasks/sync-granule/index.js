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
 * @typedef {Object} SyncGranuleConfig
 * @property {string} [stack] - The name of the deployment stack.
 * @property {string} [fileStagingDir] - Directory used for staging
 * location of files. Default is `file-staging`.
 * Granules are further organized by stack name and collection
 * name making the full path `file-staging/<stack name>/<collection name>/<optional granuleIdHash>`.
 * @property {Object} provider - Provider configuration.
 * @property {string} [provider.id] - Provider ID.
 * @property {string} [provider.username] - Provider username.
 * @property {string} [provider.password] - Provider password.
 * @property {string} provider.host - Provider host.
 * @property {number} [provider.port] - Provider port.
 * @property {number} [provider.globalConnectionLimit] - Global connection limit.
 * @property {'ftp' | 'sftp' | 'http' | 'https' | 's3'} provider.protocol - Provider protocol.
 * @property {Object.<string, {name: string, type: string}>} buckets - AWS S3
 * buckets used by this task.
 * @property {string} downloadBucket - AWS S3 bucket to use
 * when downloading files.
 * @property {Object} [collection] - Collection configuration.
 * @property {string} collection.name - Collection name.
 * @property {string} [collection.process] - Collection process.
 * @property {string} [collection.url_path] - Collection URL path.
 * @property {string} [collection.duplicateHandling] - How to handle duplicate files.
 * @property {Array<{regex: string, bucket: string, url_path?: string}>} collection.files -
 * Array of file configurations.
 * @property {Object} [pdr] - PDR configuration.
 * @property {string} pdr.name - PDR name.
 * @property {string} pdr.path - PDR path.
 * @property {'replace' | 'version' | 'skip' | 'error'} [duplicateHandling='error'] - Specifies
 * how duplicate filenames should be handled. `error` will throw
 * an error that, if not caught, will fail the task/workflow execution.
 * `version` will add a suffix to the existing filename to avoid a clash.
 * @property {boolean} [syncChecksumFiles=false] - If true, checksum files
 *  are also synced. Default: false.
 * @property {boolean} [useGranIdPath=true] - If true, use a md5 hash of the
 * granuleID in the object prefix staging location.
 * @property {number} [workflowStartTime] - Specifies the start time for
 *  the current workflow (as a timestamp) and will be used as the createdAt
 *  time for granules output.
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
