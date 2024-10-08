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
 */

/**
 * @typedef {Object} EnhancedParams
 * @property {Moment.moment} createStartTime
 * @property {string} reportKey
 * @property {string} reportType
 * @property {Knex} knex
 * @property {string} concurrency
 * @property {string} [location]
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
 */

module.exports = {};
