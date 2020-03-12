'use strict';

const flatten = require('lodash.flatten');
const pMap = require('p-map');
const moment = require('moment');
const {
  buildS3Uri,
  deleteS3Files,
  listS3ObjectsV2
} = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const log = require('@cumulus/common/log');

const DistributionEvent = require('../lib/DistributionEvent');
const {
  buildStartEndTimes,
  determineReportKey,
  determineReportsStartEndTime,
  getEmsEnabledCollections,
  getExpiredS3Objects,
  submitReports
} = require('../lib/ems');

/**
 * The following environment variables are used for generating and submitting EMS
 * distribution report:
 *
 * process.env.ems_provider: default to 'cumulus', the provider used for sending reports to EMS
 * process.env.ems_submitReport: default to 'false', indicates if the reports will be sent to EMS
 * process.env.ems_host: EMS host
 * process.env.ems_port: EMS host port
 * process.env.ems_path: EMS host directory path for reports
 * process.env.ems_username: the username used for sending reports to EMS
 * process.env.ems_privateKey: default to 'ems.private.pem', the private key file used for sending
 *   reports to EMS. privateKey filename in s3://system_bucket/stackName/crypto
 * process.env.ems_dataSource: the data source of EMS reports
 * process.env.ems_retentionInDays: the retention in days for reports and s3 server access logs
 * process.env.stackName: it's used as part of the report filename
 * process.env.system_bucket: the bucket to store the generated reports and s3 server access logs
 */

const DISTRIBUTION_REPORT = 'distribution';

const bucketsPrefixes = () => ({
  logsBucket: process.env.system_bucket,
  reportsBucket: process.env.system_bucket,
  logsPrefix: `${process.env.stackName}/ems-distribution/s3-server-access-logs/`,
  reportsPrefix: `${process.env.stackName}/ems-distribution/reports/`,
  reportsSentPrefix: `${process.env.stackName}/ems-distribution/reports/sent/`
});
exports.bucketsPrefixes = bucketsPrefixes;

/**
 * cleanup old report files and s3 access logs
 */
async function cleanup() {
  log.debug('ems-distribution-report cleanup old reports');

  const { reportsPrefix, reportsSentPrefix, logsPrefix } = bucketsPrefixes();
  const jobs = [reportsPrefix, reportsSentPrefix, logsPrefix]
    .map(async (prefix) => {
      const expiredS3Objects = await getExpiredS3Objects(
        process.env.system_bucket, prefix, process.env.ems_retentionInDays
      );
      return deleteS3Files(expiredS3Objects);
    });
  return Promise.all(jobs);
}

/**
 * Fetch an S3 object containing S3 Server Access logs and return any
 * distribution events contained in that log.
 *
 * @param {Object} params - params
 * @param {string} params.Bucket - an S3 bucket name
 * @param {string} params.Key - an S3 key
 * @returns {Array<DistributionEvent>} the DistributionEvents contained in the
 *   S3 object
 */
async function getDistributionEventsFromS3Object(params) {
  const {
    Bucket,
    Key
  } = params;

  const logLines = await awsServices.s3().getObject({ Bucket, Key }).promise()
    .then((response) => response.Body.toString().split('\n'));

  const distributionEvents = logLines
    .filter(DistributionEvent.isDistributionEvent)
    .map((logLine) => new DistributionEvent(logLine));

  log.info(`Found ${distributionEvents.length} distribution events in s3://${Bucket}/${Key}`);

  return distributionEvents;
}

/**
 * Build an EMS Distribution Report
 *
 * @param {Object} params - params
 * @param {Moment} params.reportStartTime - the earliest time to return events from (inclusive)
 * @param {Moment} params.reportEndTime - the latest time to return events from (exclusive)
 * @returns {string} an EMS distribution report
 */
async function generateDistributionReport(params) {
  const {
    reportStartTime,
    reportEndTime
  } = params;

  log.info(`generateDistributionReport for access records between ${reportStartTime.format()} and ${reportEndTime.format()}`);

  // A few utility functions that we'll be using below
  const eventTimeFilter = (event) => event.time.isBetween(reportStartTime, reportEndTime, null, '[)');
  const sortByTime = (eventA, eventB) => (eventA.time.isBefore(eventB.time) ? -1 : 1);
  // most s3 server access log records are delivered within a few hours of the time
  // that they are recorded
  const s3ObjectTimeFilter = (s3Object) =>
    s3Object.LastModified.getTime() >= reportStartTime.toDate().getTime();

  const { logsBucket, logsPrefix } = bucketsPrefixes();
  // Get the list of S3 objects containing Server Access logs
  const s3Objects = (await listS3ObjectsV2({ Bucket: logsBucket, Prefix: logsPrefix }))
    .filter(s3ObjectTimeFilter)
    .map((s3Object) => ({ Bucket: logsBucket, Key: s3Object.Key }));

  log.info(`Found ${s3Objects.length} log files in S3 after ${reportStartTime.format()}`);

  // Fetch all distribution events from S3
  const allDistributionEvents = flatten(await pMap(
    s3Objects,
    getDistributionEventsFromS3Object,
    { concurrency: 5 }
  ));

  log.info(`Found a total of ${allDistributionEvents.length} distribution events`);

  const distributionEventsInReportPeriod = allDistributionEvents.filter(eventTimeFilter);

  log.info(`Found ${distributionEventsInReportPeriod.length} distribution events between `
    + `${reportStartTime.format()} and ${reportEndTime.format()}`);

  const emsCollections = await getEmsEnabledCollections();

  // populate event.productInfo and filter only event for EMS enabled collections
  const distributionEventsForEms = (await Promise.all(distributionEventsInReportPeriod
    .map(async (event) => {
      await event.getProductInfo();
      return event;
    })))
    .filter((event) => emsCollections.includes(event.productInfo.collectionId));

  log.info(`Found ${distributionEventsForEms.length} distribution events for EMS`);

  return (await Promise.all(distributionEventsForEms
    .sort(sortByTime)
    .map((event) => event.toString())))
    .join('\n');
}

/**
 * Generate and store an EMS Distribution Report
 *
 * @param {Object} params - params
 * @param {string} params.startTime - the earliest time to return events from (inclusive)
 * in format YYYY-MM-DDTHH:mm:ss
 * @param {string} params.endTime - the latest time to return events from (exclusive)
 * in format YYYY-MM-DDTHH:mm:ss
 * @returns {Promise} resolves when the report has been generated
 */
async function generateAndStoreDistributionReport(params) {
  const {
    startTime,
    endTime
  } = params;

  const distributionReport = await generateDistributionReport({
    reportStartTime: moment.utc(startTime),
    reportEndTime: moment.utc(endTime)
  });

  const { reportsBucket, reportsPrefix } = bucketsPrefixes();
  const reportKey = await determineReportKey(DISTRIBUTION_REPORT, startTime, reportsPrefix);

  const s3Uri = buildS3Uri(reportsBucket, reportKey);
  log.info(`Uploading report to ${s3Uri}`);

  return awsServices.s3().putObject({
    Bucket: reportsBucket,
    Key: reportKey,
    Body: distributionReport
  }).promise()
    .then(() => ({ reportType: DISTRIBUTION_REPORT, file: s3Uri }));
}
// Export to support testing
exports.generateAndStoreDistributionReport = generateAndStoreDistributionReport;

/**
 * Generate and store EMS Distribution Reports for each day
 *
 * @param {Object} params - params
 * @param {string} params.startTime - the earliest time to return events from (inclusive)
 * in format YYYY-MM-DDTHH:mm:ss
 * @param {string} params.endTime - the latest time to return events from (exclusive)
 * in format YYYY-MM-DDTHH:mm:ss
 * @returns {Promise} resolves when the report has been generated
 */
async function generateAndStoreReportsForEachDay(params) {
  log.info('generateAndStoreReportsForEachDay for access records between'
    + `${params.startTime} and ${params.endTime}`);

  const reportTimes = determineReportsStartEndTime(params.startTime, params.endTime);
  let reportStartTime = reportTimes.reportStartTime;
  const reportEndTime = reportTimes.reportEndTime;

  // Each file should contain one day's worth of data.
  // Data within the file will correspond to the datestamp in the filename.
  // For distribution data, the revision file content will overwrite all previous records
  // for that file. So the records can't be limit to a particular collection.

  // limit the startTime within the retention days so that the s3 access logs are still available.
  const earliestReportStartDate = moment.utc().subtract(process.env.ems_retentionInDays - 1, 'days').startOf('day');

  if (reportStartTime.isBefore(earliestReportStartDate)) reportStartTime = earliestReportStartDate;

  const startEndTimes = buildStartEndTimes(reportStartTime, reportEndTime);

  return Promise.all(startEndTimes.map((startEndTime) =>
    generateAndStoreDistributionReport({ ...params, ...startEndTime })));
}
// Export to support testing
exports.generateAndStoreReportsForEachDay = generateAndStoreReportsForEachDay;


/**
 * A lambda task for generating and EMS Distribution Report
 *
 * @param {Object} event - an AWS Lambda event
 * @param {string} event.startTime - optional, report startTime in format YYYY-MM-DDTHH:mm:ss
 * @param {string} event.endTime - optional, report endTime in format YYYY-MM-DDTHH:mm:ss
 * @param {Object} context - an AWS Lambda execution context
 * @param {function} cb - an AWS Lambda callback function
 * @returns {Promise} resolves when the report has been generated and stored
 */
function handler(event, context, cb) {
  // eslint-disable-next-line no-param-reassign
  context.callbackWaitsForEmptyEventLoop = false;
  // 24-hour period ending past midnight
  let endTime = moment.utc().startOf('day').format();
  let startTime = moment.utc().subtract(1, 'days').startOf('day').format();

  endTime = event.endTime || endTime;
  startTime = event.startTime || startTime;

  const params = {
    startTime,
    endTime,
    logsBucket: process.env.system_bucket,
    logsPrefix: `${process.env.stackName}/ems-distribution/s3-server-access-logs/`,
    reportsBucket: process.env.system_bucket,
    reportsPrefix: `${process.env.stackName}/ems-distribution/reports/`,
    provider: process.env.ems_provider || 'cumulus',
    stackName: process.env.stackName
  };

  // catch up run to generate reports for each day
  if (event.startTime && event.endTime) {
    return generateAndStoreReportsForEachDay((params))
      .then((reports) => submitReports(reports))
      .catch(cb);
  }

  return cleanup()
    .then(() => generateAndStoreDistributionReport(params))
    .then((report) => submitReports([report]))
    .catch(cb);
}
exports.handler = handler;
