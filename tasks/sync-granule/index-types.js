/**
 * @typedef {Object} SyncGranulePDR
 * @property {string} name - PDR name
 * @property {string} path - PDR path
*/

/**
 * @typedef {Object} SyncGranuleConfig
 * @property {string} [stack] - The name of the deployment stack.
 * @property {string} [fileStagingDir] - Directory used for staging
 * location of files. Default is `file-staging`.
 * Granules are further organized by stack name and collection
 * name making the full path `file-staging/<stack name>/<collection name>/<optional granuleIdHash>`.
 * @property {import('@cumulus/types').ApiProvider} provider - Provider configuration.
 * @property {Object.<string, {name: string, type: string}>} buckets - AWS S3
 * buckets used by this task.
 * @property {string} downloadBucket - AWS S3 bucket to use
 * when downloading files.
 * @property {import('@cumulus/types').NewCollectionRecord} [collection] - Collection configuration.
 * @property {SyncGranulePDR} [pdr] - PDR configuration.
 * @property {import('@cumulus/types').DuplicateHandling} [duplicateHandling='error'] - Specifies
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

module.exports = {};
