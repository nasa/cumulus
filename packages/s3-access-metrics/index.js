'use strict';

// eslint-disable-next-line node/no-unpublished-require
const AWS = require('aws-sdk');
const chunk = require('lodash.chunk');
const compose = require('lodash.flowright');
const curry = require('lodash.curry');
const flatten = require('lodash.flatten');
const groupBy = require('lodash.groupby');
const moment = require('moment');
const {
  filter,
  map,
  splitLines,
  trim
} = require('./utils');

// Business logic

const fetchObject = async (params) => {
  const { Body } = await (new AWS.S3()).getObject(params).promise();
  return Body.toString();
};

// Given an S3 Server Access Log line, return the line's timestamp.  This is
// represented as the number of seconds since the Unix epoch.  Milliseconds
// and seconds are rounded down to 0 so that all of the events from a given
// minute can be counted together.
const getTimestampFromLogLine = (line) => {
  const rawTimestamp = line.split(/[\[\]]/)[1];

  return moment(rawTimestamp, 'DD/MMM/YYYY:HH:mm:ss Z')
    .seconds(0)
    .milliseconds(0)
    .unix();
};

// Given an S3 server Access Log line, return the HTTP status code of the
// request
const getHttpStatusFromLogLine = (line) =>
  Number(line.split('"')[2].trim().split(' ')[0]);

// Given an S3 Server Access Log line, return the S3 operation of the request
const getOperationFromLogLine = (line) => {
  const result = line.match(/\s+([A-Z]+\.[A-Z]+\.[A-Z_]+)\s+/);

  return result ? result[1] : null;
};

// Given an S3 Server Access Log line, return an object with the line's
// timestamp, S3 operation, and HTTP status
const logLineToLogEvent = (line) => ({
  timestamp: getTimestampFromLogLine(line),
  operation: getOperationFromLogLine(line),
  httpStatus: getHttpStatusFromLogLine(line)
});

const getEventTimestampAsString = (event) => `${event.timestamp}`;

// Given a metric name, stack name, and list of log events, return a metric
// data object as documented here: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudWatch.html#putMetricData-property
const buildMetricDataObject = curry((MetricName, stack, logEvents) => ({
  MetricName,
  Dimensions: [
    { Name: 'Stack', Value: stack }
  ],
  StorageResolution: '60',
  Timestamp: moment.unix(logEvents[0].timestamp).toISOString(),
  Unit: 'Count',
  Value: logEvents.length
}));

const buildSuccessMetricData = buildMetricDataObject('SuccessCount');
const buildFailureMetricData = buildMetricDataObject('FailureCount');

const isSuccessLogEvent = (event) => event.httpStatus === 200;
const isNotSuccessLogEvent = (event) => !isSuccessLogEvent(event);

const isGetObjectLogEvent = (event) => event.operation.endsWith('.GET.OBJECT');

// Given a list of log events, return the ones that are for GET.OBJECT
const selectGetObjectLogEvents = filter(isGetObjectLogEvent);

// Given a stack name and a list of GET.OBJECT log events, return a list of
// metric data objects for successful requests
const getSuccessMetricDataObjects = (stack, logEvents) => {
  const groupedSuccessEvents = groupBy(
    logEvents.filter(isSuccessLogEvent),
    getEventTimestampAsString
  );
  return Object.values(groupedSuccessEvents)
    .map(buildSuccessMetricData(stack));
};

// Given a stack name and a list of GET.OBJECT log events, return a list of
// metric data objects for failure requests
const getFailureMetricDataObjects = (stack, logEvents) => {
  const groupedFailureEvents = groupBy(
    logEvents.filter(isNotSuccessLogEvent),
    getEventTimestampAsString
  );
  return Object.values(groupedFailureEvents)
    .map(buildFailureMetricData(stack));
};

// Convert a list of log lines to a list of log events
const logLinesToLogEvents = map(logLineToLogEvent);

// Given an access log, return a list of log events
const logEventsFromAccessLog = compose([logLinesToLogEvents, splitLines, trim]);

// Given a stack name and an access log, return a list of metric data objects
const metricDataObjectsFromAccessLog = curry((stack, accessLog) => {
  const logEvents = logEventsFromAccessLog(accessLog);
  const getObjectLogEvents = selectGetObjectLogEvents(logEvents);
  return flatten([
    getSuccessMetricDataObjects(stack, getObjectLogEvents),
    getFailureMetricDataObjects(stack, getObjectLogEvents)
  ]);
});

// Given a stack name and a logLocation object with Bucket and Key properties,
// fetch that S3 Server Access Log from S3 and return a list of metric data
// objects to be uploaded to Cloudwatch Metrics
const getMetricDataObjectsFromAccessLog = curry((stack, logLocation) =>
  fetchObject(logLocation)
    .then(metricDataObjectsFromAccessLog(stack)));

// Given a list of Cloudwatch Metric Data, upload that data to Cloudwatc
const putMetricDataObjects = (metricDataObjects) => {
  const cloudwatch = new AWS.CloudWatch();

  const performPut = (MetricData) =>
    cloudwatch.putMetricData({
      Namespace: 'CumulusDistribution',
      MetricData
    }).promise();

  const promisedPuts = chunk(metricDataObjects, 20).map(performPut);

  return Promise.all(promisedPuts);
};

// Given a stack name and a list of S3 Server Access log locations, fetch the
// logs and build metric data objects from the logs.
const getMetricDataFromAccessLogs = (stack, logLocations) =>
  Promise.all(logLocations.map(getMetricDataObjectsFromAccessLog(stack)))
    .then(flatten);

// Given an event record, return the S3 Bucket and Key that the event record
// is referencing.
const s3ParamsFromRecord = (record) => ({
  Bucket: record.s3.bucket.name,
  Key: record.s3.object.key
});

// Handle an S3 object upload event
const handleEvent = (event, stack) => {
  const logLocations = event.Records.map(s3ParamsFromRecord);

  return getMetricDataFromAccessLogs(stack, logLocations)
    .then(putMetricDataObjects);
};

module.exports = {
  handler: async (event) => handleEvent(event, process.env.stack),

  // Exported to support testing
  buildMetricDataObject,
  getHttpStatusFromLogLine,
  getSuccessMetricDataObjects,
  getOperationFromLogLine,
  getTimestampFromLogLine,
  getFailureMetricDataObjects,
  logLineToLogEvent,
  metricDataObjectsFromAccessLog,
  s3ParamsFromRecord
};
