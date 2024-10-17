/**
 * @typedef {import('@cumulus/types/api/files').ApiFile} ApiFile
 */

/**
 * @typedef {Object} Env
 * @property {string} [CONCURRENCY] - The concurrency level for processing.
 * @property {string} [ES_INDEX] - The Elasticsearch index.
 * @property {string} [AWS_REGION] - The AWS region.
 * @property {string} [AWS_ACCESS_KEY_ID] - The AWS access key ID.
 * @property {string} [AWS_SECRET_ACCESS_KEY] - The AWS secret access key.
 * @property {string} [AWS_SESSION_TOKEN] - The AWS session token.
 * @property {string} [NODE_ENV] - The Node.js environment (e.g., 'development', 'production').
 * @property {string} [DATABASE_URL] - The database connection URL.
 * @property {string} [key] string - Any other environment variable as a string.
 */

/**
 * @typedef {Object} CMRCollectionItem
 * @property {Object} umm - The UMM (Unified Metadata Model) object for the granule.
 * @property {string} umm.ShortName - The short name of the collection.
 * @property {string} umm.Version - The version of the collection.
 * @property {Array<Object>} umm.RelatedUrls - The related URLs for the granule.
 */

/**
 * @typedef {Object} CMRItem
 * @property {Object} umm - The UMM (Unified Metadata Model) object for the granule.
 * @property {string} umm.GranuleUR - The unique identifier for the granule in CMR.
 * @property {Object} umm.CollectionReference - The collection reference object.
 * @property {string} umm.CollectionReference.ShortName - The short name of the collection.
 * @property {string} umm.CollectionReference.Version - The version of the collection.
 * @property {Array<Object>} umm.RelatedUrls - The related URLs for the granule.
 */

/**
 * @typedef {Object} FilesReport
 * @property {number} okCount
 * @property {ApiFile[]} onlyInCumulus
 * @property {ApiFile[]} onlyInCmr
 *
 */

/**
 * @typedef {Object} GranulesReport
 * @property {number} okCount - The count of OK granules.
 * @property {Array<{GranuleUR: string, ShortName: string, Version: string}>} onlyInCmr
 * - The list of granules only in Cumulus.
 * @property {Array<{granuleId: string, collectionId: string}>} onlyInCumulus
 */

/**
  * @typedef {Object} FilesInCumulus
  * @property {number} okCount
  * @property {Object<string, number>} okCountByGranule
  * @property {string[]} onlyInS3
  * @property {Object[]} onlyInDb
  */
/**
 *
 * @param {string} reportType - reconciliation report type
 * @returns {boolean} - Whether or not to include the link between files and
 * granules in the report.
 */

module.exports = {};
