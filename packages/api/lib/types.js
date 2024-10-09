/**
 * @typedef {Object} NormalizedRecReportParams
 * @property {string[]} [collectionIds] - An optional array of collection IDs.
 * @property {string[]} [granuleIds] - An optional array of granule IDs.
 * @property {string[]} [providers] - An optional array of provider names.
 * @property {string} [startTimestamp] - An optional start timestamp for the report.
 * @property {string} [endTimestamp] - An optional end timestamp for the report.
 * @property {string} [reportType] - An optional type of the report.
 * @property {string} [location]
 * @property {string} stackName
 * @property {string} systemBucket
 * @property {string} [status] - Optional granule status filter for report
 */

/**
 * @typedef {Object} EnhancedParams
 * @property {Moment.moment} createStartTime - Report creation start time.
 * @property {string} reportKey - Key to store report object in S3
 * @property {string} reportType - Type of the report
 * @property {Knex} knex - Knex instance
 * @property {string} concurrency - Concurrency used in report generation
 * @property {string} [location] - Location of the report
*/

/**
 * @typedef { NormalizedRecReportParams & EnhancedParams} EnhancedNormalizedRecReportParams
 */

/**
 * @typedef {Object} RecReportParams
 * @property {string[]} [collectionIds] - An optional array of collection IDs.
 * @property {string[]} [granuleIds] - An optional array of granule IDs.
 * @property {string[]} [providers] - An optional array of provider names.
 * @property {string|Date} [startTimestamp] - An optional start timestamp for the report.
 * @property {string|Date} [endTimestamp] - An optional end timestamp for the report.
 * @property {string} [reportType] - An optional type of the report.
 * @property {boolean} [includeDeleted] - An optional flag to include deleted records.
 * @property {boolean} [ignoreFilesConfig] - An optional flag to ignore files configuration.
 * @property {string} [bucket] - An optional bucket name for the report.
 * @property {string} [stackName] - An optional stack name for the report.
 * @property {string} [systemBucket] - An optional system bucket name for the report.
 * @property {string} [location]
 * @property {string} [status] - Optional granule status filter for report
 */

module.exports = {};
