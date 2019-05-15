'use strict';

// eslint-disable-next-line node/no-unpublished-require
const AWS = require('aws-sdk');
const chunk = require('lodash.chunk');
const curry = require('lodash.curry');
const flatten = require('lodash.flatten');
const groupBy = require('lodash.groupby');
const moment = require('moment');

const fetchObject = async (params) => {
  const { Body } = await (new AWS.S3()).getObject(params).promise();
  return Body.toString();
};

const getBucketFromLogLine = (line) => line.split(/\s+/)[1];

const getTimestampFromLogLine = (line) => {
  const rawTimestamp = line.split(/[\[\]]/)[1];

  return moment(rawTimestamp, 'DD/MMM/YYYY:HH:mm:ss Z')
    .seconds(0)
    .milliseconds(0)
    .unix();
};

const getHttpStatusFromLogLine = (line) =>
  Number(line.split('"')[2].trim().split(' ')[0]);

const getOperationFromLogLine = (line) => {
  const result = line.match(/\s+([A-Z]+\.[A-Z]+\.[A-Z]+)\s+/);

  return result ? result[1] : null;
};

const logLineToLogEvent = (line) => ({
  bucket: getBucketFromLogLine(line),
  timestamp: getTimestampFromLogLine(line),
  operation: getOperationFromLogLine(line),
  httpStatus: getHttpStatusFromLogLine(line)
});

const fetchLogEvents = (s3Params) =>
  fetchObject(s3Params)
    .then((obj) => obj.trim())
    .then((obj) => obj.split('\n'))
    .then((lines) => lines.map(logLineToLogEvent));

const getEventTimestampAsString = (event) => `${event.timestamp}`;

const buildMetricData = curry((MetricName, stack, logEvents) => ({
  MetricName,
  Dimensions: [
    { Name: 'Stack', Value: stack },
    { Name: 'Bucket', Value: logEvents[0].bucket }
  ],
  StorageResolution: '60',
  Timestamp: moment.unix(logEvents[0].timestamp).toISOString(),
  Unit: 'Count',
  Value: logEvents.length
}));

const buildSuccessMetricData = buildMetricData('SuccessCount');
const buildFailureMetricData = buildMetricData('FailureCount');

const isSuccessEvent = (event) => event.httpStatus === 200;
const isNotSuccessEvent = (event) => !isSuccessEvent(event);

const isGetObjectEvent = (event) => event.operation.endsWith('.GET.OBJECT');

const selectGetObjectEvents = (logEvents) => logEvents.filter(isGetObjectEvent);

const getSuccessMetricData = (stack, logEvents) => {
  const groupedSuccessEvents = groupBy(
    logEvents.filter(isSuccessEvent),
    getEventTimestampAsString
  );
  return Object.values(groupedSuccessEvents)
    .map(buildSuccessMetricData(stack));
};

const getFailureMetricData = (stack, logEvents) => {
  const groupedFailureEvents = groupBy(
    logEvents.filter(isNotSuccessEvent),
    getEventTimestampAsString
  );
  return Object.values(groupedFailureEvents)
    .map(buildFailureMetricData(stack));
};

const getMetricDataFromAccessLog = curry((stack, logLocation) =>
  fetchLogEvents(logLocation)
    .then(selectGetObjectEvents)
    .then((logEvents) => [
      getSuccessMetricData(stack, logEvents),
      getFailureMetricData(stack, logEvents)
    ])
    .then(flatten));

const putMetricData = (metricData) => {
  const cloudwatch = new AWS.CloudWatch();

  const performPut = (MetricData) =>
    cloudwatch.putMetricData({
      Namespace: 'CumulusDistribution',
      MetricData
    }).promise();

  const promisedPuts = chunk(metricData, 20).map(performPut);

  return Promise.all(promisedPuts);
};

const getMetricDataFromAccessLogs = (stack, logLocations) =>
  Promise.all(logLocations.map(getMetricDataFromAccessLog(stack)))
    .then(flatten);

const s3ParamsFromRecord = (record) => ({
  Bucket: record.s3.bucket.name,
  Key: record.s3.object.key
});

const handleEvent = (event, stack) => {
  const logLocations = event.Records.map(s3ParamsFromRecord);

  return getMetricDataFromAccessLogs(stack, logLocations)
    .then(putMetricData);
};

// eslint-disable-next-line no-console
const jlog = (x) => console.log(JSON.stringify(x, null, 2));

exports.handler = async (event) =>
  handleEvent(event, process.env.stack).then(jlog);
