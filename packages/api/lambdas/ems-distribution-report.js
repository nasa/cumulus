'use strict';

const flatten = require('lodash.flatten');
const pMap = require('p-map');
const moment = require('moment');
const { aws } = require('@cumulus/common');
const { URL } = require('url');
const {
  aws: {
    s3Join
  },
  log
} = require('@cumulus/common');

/**
 * This class takes an S3 Server Log line and parses it for EMS Distribution Logs
 *
 * The format of S3 Server Log lines is documented here:
 *
 * https://docs.aws.amazon.com/AmazonS3/latest/dev/LogFormat.html
 *
 * Example S3 Server Log line:
 *
 * fe3f16719bb293e218f6e5fea86e345b0a696560d784177395715b24041da90e my-dist-bucket
 * [01/June/1981:01:02:13 +0000] 192.0.2.3 arn:aws:iam::000000000000:user/joe
 * 1CB21F5399FF76C5 REST.GET.OBJECT my-dist-bucket/pdrs/
 * MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR
 * "GET /my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR?AWSAccessKeyId=
 * AKIAIOSFODNN7EXAMPLE&Expires=1525892130&Signature=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX&x-
 * EarthdataLoginUsername=amalkin HTTP/1.1" 200 - 807 100 22 22 "-" "curl/7.59.0" -
 *
 */
class DistributionEvent {
  /**
   * Test if a given S3 Server Access Log line contains a distribution event
   *
   * @param {string} s3ServerLogLine - An S3 Server Access Log line
   * @returns {boolean} `true` if the line contains a distribution event,
   *   `false` otherwise
   */
  static isDistributionEvent(s3ServerLogLine) {
    return s3ServerLogLine.includes('REST.GET.OBJECT')
      && s3ServerLogLine.includes('x-EarthdataLoginUsername');
  }

  /**
   * Constructor for DistributionEvent objects
   *
   * @param {string} s3ServerLogLine - an S3 Server Log line
   */
  constructor(s3ServerLogLine) {
    if (!DistributionEvent.isDistributionEvent(s3ServerLogLine)) {
      throw new Error(`Invalid distribution event: ${s3ServerLogLine}`);
    }

    this.rawLine = s3ServerLogLine;
  }

  /**
   * Get the bucket that the object was fetched from
   *
   * @returns {string} a bucket name
   */
  get bucket() {
    return this.rawLine.split(' ')[1];
  }

  /**
   * Get the number of bytes sent to the client
   *
   * @returns {number} bytes sent
   */
  get bytesSent() {
    return parseInt(this.rawLine.split('"')[2].trim().split(' ')[2], 10);
  }

  /**
   * Get the key of the object that was fetched
   *
   * @returns {string} an S3 key
   */
  get key() {
    return this.rawLine.split('REST.GET.OBJECT')[1].trim().split(' ')[0];
  }

  /**
   * Get the client's IP address
   *
   * @returns {string} an IP address
   */
  get remoteIP() {
    return this.rawLine.split(']')[1].trim().split(' ')[0];
  }

  /**
   * Get the size of the object
   *
   * @returns {number} size in bytes
   */
  get objectSize() {
    return parseInt(this.rawLine.split('"')[2].trim().split(' ')[3], 10);
  }

  /**
   * Get the time of the event
   *
   * @returns {Moment} the time of the event
   */
  get time() {
    return moment(
      this.rawLine.split('[')[1].split(']')[0],
      'DD/MMM/YYYY:hh:mm:ss ZZ'
    ).utc();
  }

  /**
   * Get the success or failure status of the event
   *
   * @returns {string} "S" or "F"
   */
  get transferStatus() {
    return this.bytesSent === this.objectSize ? 'S' : 'F';
  }

  /**
   * Get the Earthdata Login username that fetched the S3 object
   *
   * @returns {string} a username
   */
  get username() {
    const requestUri = this.rawLine.split('"')[1].split(' ')[1];
    const parsedUri = (new URL(requestUri, 'http://localhost'));
    return parsedUri.searchParams.get('x-EarthdataLoginUsername');
  }

  /**
   * Return the event in an EMS-parsable format
   *
   * @returns {string} an EMS distribution log entry
   */
  toString() {
    const upperCasedMonth = this.time.format('MMM').toUpperCase();

    return [
      this.time.format(`DD-[${upperCasedMonth}]-YY hh.mm.ss.SSSSSS A`),
      this.username,
      this.remoteIP,
      `s3://${this.bucket}/${this.key}`,
      this.bytesSent,
      this.transferStatus
    ].join('|&|');
  }
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

  const logLines = await aws.s3().getObject({ Bucket, Key }).promise()
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
 * @param {string} params.logsBucket - the bucket containing S3 Server Access logs
 * @param {string} params.logsPrefix - the S3 prefix where the logs are located
 * @param {Moment} params.reportStartTime - the earliest time to return events from (inclusive)
 * @param {Moment} params.reportEndTime - the latest time to return events from (exclusive)
 * @returns {string} an EMS distribution report
 */
async function generateDistributionReport(params) {
  const {
    reportStartTime,
    reportEndTime,
    logsBucket,
    logsPrefix
  } = params;

  // A few utility functions that we'll be using below
  const timeFilter = (event) => event.time >= reportStartTime && event.time < reportEndTime;
  const sortByTime = (eventA, eventB) => (eventA.time < eventB.time ? -1 : 1);

  // Get the list of S3 objects containing Server Access logs
  const s3Objects = (await aws.listS3ObjectsV2({ Bucket: logsBucket, Prefix: logsPrefix }))
    .map((s3Object) => ({ Bucket: logsBucket, Key: s3Object.Key }));

  log.info(`Found ${s3Objects.length} log files in S3`);

  // Fetch all distribution events from S3
  const allDistributionEvents = flatten(await pMap(
    s3Objects,
    getDistributionEventsFromS3Object,
    { concurrency: 5 }
  ));

  log.info(`Found a total of ${allDistributionEvents.length} distribution events`);

  const distributionEventsInReportPeriod = allDistributionEvents.filter(timeFilter);

  log.info(`Found ${allDistributionEvents.length} distribution events between `
    + `${reportStartTime.toString()} and ${reportEndTime.toString()}`);

  return distributionEventsInReportPeriod.sort(sortByTime).join('\n');
}

/**
 * Determine the S3 key where the report should be stored
 *
 * @param {Object} params - params
 * @param {string} params.reportsBucket - the bucket containing the EMS reports
 * @param {string} params.reportsPrefix - the S3 prefix where the reports are located
 * @param {Moment} params.reportStartTime - the timestamp of the report
 * @param {string} params.provider - the report provider
 * @param {string} params.stackName - the Cumulus stack name
 * @returns {string} the S3 key where the report should be stored
 */
async function determineReportKey(params) {
  const {
    reportsBucket,
    reportsPrefix,
    reportStartTime,
    provider,
    stackName
  } = params;

  let reportName = `${reportStartTime.format('YYYYMMDD')}_${provider}_DistCustom_${stackName}.flt`;

  const revisionNumber = (await aws.listS3ObjectsV2({
    Bucket: reportsBucket,
    Prefix: s3Join([reportsPrefix, reportName])
  })).length;

  if (revisionNumber > 0) reportName = `${reportName}.rev${revisionNumber}`;

  return s3Join([reportsPrefix, reportName]);
}

/**
 * Generate and store an EMS Distribution Report
 *
 * @param {Object} params - params
 * @param {Moment} params.reportStartTime - the earliest time to return events from (inclusive)
 * @param {Moment} params.reportEndTime - the latest time to return events from (exclusive)
 * @param {string} params.logsBucket - the bucket containing S3 Server Access logs
 * @param {string} params.logsPrefix - the S3 prefix where the logs are located
 * @param {string} params.reportsBucket - the bucket containing the EMS reports
 * @param {string} params.reportsPrefix - the S3 prefix where the reports are located
 * @param {string} params.stackName - the Cumulus stack name
 * @param {string} params.provider - the report provider. Defaults to "cumulus"
 * @returns {Promise} resolves when the report has been generated
 */
async function generateAndStoreDistributionReport(params) {
  const {
    reportStartTime,
    reportEndTime,
    logsBucket,
    logsPrefix,
    reportsBucket,
    reportsPrefix,
    stackName,
    provider = 'cumulus'
  } = params;

  const distributionReport = await generateDistributionReport({
    reportStartTime,
    reportEndTime,
    logsBucket,
    logsPrefix
  });

  const reportKey = await determineReportKey({
    reportsBucket,
    reportsPrefix,
    reportStartTime,
    provider,
    stackName
  });

  log.info(`Uploading report to s3://${reportsBucket}/${reportKey}`);

  return aws.s3().putObject({
    Bucket: reportsBucket,
    Key: reportKey,
    Body: distributionReport
  }).promise()
    .then(() => null);
}
// Export to support testing
exports.generateAndStoreDistributionReport = generateAndStoreDistributionReport;

/**
 * A lambda task for generating and EMS Distribution Report
 *
 * @param {Object} _event - an AWS Lambda event
 * @param {Object} _context - an AWS Lambda execution context (not used)
 * @param {function} cb - an AWS Lambda callback function
 * @returns {Promise} resolves when the report has been generated and stored
 */
function handler(_event, _context, cb) {
  const now = moment.utc();

  return generateAndStoreDistributionReport({
    reportStartTime: moment(now).startOf('day').subtract(1, 'day'),
    reportEndTime: moment(now).startOf('day'),
    logsBucket: process.env.LOGS_BUCKET,
    logsPrefix: `${process.env.STACK_NAME}/ems-distribution/s3-server-access-logs/`,
    reportsBucket: process.env.REPORTS_BUCKET,
    reportsPrefix: `${process.env.STACK_NAME}/ems-distribution/reports/`,
    provider: 'cumulus',
    stackName: process.env.STACK_NAME
  })
    .catch(cb);
}
exports.handler = handler;
