'use strict';

const log = require('@cumulus/common/log');
const moment = require('moment');
const { aws } = require('@cumulus/common');
const { TaskQueue } = require('cwait');
const { URL } = require('url');

/**
 * This class takes an S3 Server Log line and parses it for EMS Distribution Logs
 */
class DistributionEvent {
  static isDistributionEvent(s3ServerLogLine) {
    return s3ServerLogLine.includes('REST.GET.OBJECT')
      && s3ServerLogLine.includes('x-EarthdataLoginUsername');
  }

  constructor(s3ServerLogLine) {
    if (!DistributionEvent.isDistributionEvent(s3ServerLogLine)) {
      throw new Error(`Invalid distribution event: ${s3ServerLogLine}`);
    }

    this.rawLine = s3ServerLogLine;
  }

  get bucket() {
    return this.rawLine.split(' ')[1];
  }

  get bytesSent() {
    return this.rawLine.split('"')[2].trim().split(' ')[2];
  }

  get key() {
    return this.rawLine.split('REST.GET.OBJECT')[1].trim().split(' ')[0];
  }

  get remoteIP() {
    return this.rawLine.split(']')[1].trim().split(' ')[0];
  }

  get objectSize() {
    return this.rawLine.split('"')[2].trim().split(' ')[3];
  }

  get time() {
    return moment(
      this.rawLine.split('[')[1].split(']')[0],
      'DD/MMM/YYYY:HH:mm:ss ZZ'
    );
  }

  get transferStatus() {
    return this.bytesSent === this.objectSize ? 'S' : 'F';
  }

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
    return [
      this.time.toISOString(),
      this.username,
      this.remoteIP,
      `s3://${this.bucket}/${this.key}`,
      this.bytesSent,
      this.transferStatus
    ].join('|&|');
  }
}

async function fetchEventsFromObject(getObjectParams) {
  log.info(`Fetching events from s3://${getObjectParams.Bucket}/${getObjectParams.Key}`);

  // Fetch the S3 Server Log object from S3
  const getObjectResponse = await aws.s3().getObject(getObjectParams).promise();

  return getObjectResponse.Body
    // Get the contents of the S3 object
    .toString()
    // Break the file into separate lines
    .split('\n')
    // Remove lines that aren't for distribution events
    .filter(DistributionEvent.isDistributionEvent)
    // Convert the remaining lines into DistributionEvent objects
    .map((logLine) => new DistributionEvent(logLine));
}

async function fetchEvents(sourceBucket, startTime, endTime) {
  log.info(`Fetching distribution logs from ${startTime.toISOString()} to ${endTime.toISOString()}`); // eslint-disable-line max-len

  // Fetch all of the log objects in the S3 bucket
  const s3Objects = await aws.listS3ObjectsV2({ Bucket: sourceBucket });
  // We only want the Bucket and Key properties
  const simpleS3Objects = s3Objects.map((s3Object) =>
    ({ Bucket: sourceBucket, Key: s3Object.Key }));

  // Throttle how many log objects we fetch and parse in parallel
  const queue = new TaskQueue(Promise, 5);
  const throttledFetchEventsFromObject = queue.wrap(fetchEventsFromObject);

  // A few utility functions that we'll be using below
  const flatten = (accumulator, currentValue) => accumulator.concat(currentValue);
  const timeFilter = (event) => event.time >= startTime && event.time < endTime;
  const sortByTime = (eventA, eventB) => (eventA.time < eventB.time ? -1 : 1);

  // Fetch all distribution events from S3
  return (await Promise.all(simpleS3Objects.map(throttledFetchEventsFromObject)))
    // Flatten the result arrays into a single array
    .reduce(flatten, [])
    // Remove results outside of the specified timerange
    .filter(timeFilter)
    // Sort the results
    .sort(sortByTime);
}

function storeDistributionReport(params) {
  const {
    destinationBucket,
    distributionReport,
    startTime,
    endTime
  } = params;

  const destinationKey = `${startTime.toISOString()}_to_${endTime.toISOString()}.log`;

  log.info(`Writing EMS distribution logs to s3://${destinationBucket}/${destinationKey}`);

  return aws.s3().putObject({
    Bucket: destinationBucket,
    Key: destinationKey,
    Body: distributionReport
  }).promise();
}

async function generateAndStoreDistributionReport(params) {
  const {
    sourceBucket,
    destinationBucket,
    startTime,
    endTime
  } = params;

  const distributionEvents = await fetchEvents(sourceBucket, startTime, endTime);
  const distributionReport = distributionEvents.join('\n');

  return storeDistributionReport({
    destinationBucket,
    distributionReport,
    startTime,
    endTime
  });
}

function handler(event, _context, cb) {
  const startTime = event.startTime
    ? moment(event.startTime) // Used during testing
    : moment.utc().subtract(1, 'day').startOf('day'); // Default to midnight yesterday
  const endTime = event.endTime
    ? moment(event.endTime) // Used during testing
    : moment(startTime).add(1, 'day'); // Default to one day after the startTime

  return generateAndStoreDistributionReport({
    startTime,
    endTime,
    sourceBucket: process.env.SOURCE_BUCKET,
    destinationBucket: process.env.DESTINATION_BUCKET
  })
    .catch(cb);
}
exports.handler = handler;
