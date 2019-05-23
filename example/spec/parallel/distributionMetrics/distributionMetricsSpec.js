'use strict';

const AWS = require('aws-sdk');
const pRetry = require('p-retry');

const {
  testUtils: { randomId }
} = require('@cumulus/common');

const {
  api: { distributionMetrics }
} = require('@cumulus/integration-tests');

const { loadConfig } = require('../../helpers/testUtils');
const config = loadConfig();

const cloudwatch = new AWS.CloudWatch();
const stackName = randomId('stack');

const buildMetricDataObject = (MetricName, stack, aDate, numberOfEvents) => ({
  MetricName,
  Dimensions: [{ Name: 'Stack', Value: stack }],
  StorageResolution: '60',
  Timestamp: aDate.toISOString(),
  Unit: 'Count',
  Value: numberOfEvents
});

// Given a list of Cloudwatch Metric Data, upload that data to Cloudwatc
const putMetricDataObject = (MetricData) =>
  cloudwatch
    .putMetricData({
      Namespace: 'CumulusDistribution',
      MetricData
    })
    .promise();

const listMetricData = (params) => cloudwatch.listMetrics({ params }).promise();

const getMetricData = (MetricData) =>
  cloudwatch.getMetricData({ MetricData }).promise();

const metricExists = async (params) => {
  const metrics = await listMetricData(params);
  if (metrics.Metrics.length === 0) {
    throw new Error('Metric not found...retry');
  }
  return true;
};

const metricAvailableInCloudwatch = (metricDataObject) => {
  // Waits until you can see it in cloudwatch
  const MetricName = metricDataObject.MetricName;
  const Dimensions = metricDataObject.Dimensions;
  const params = {
    MetricName,
    Dimensions,
    Namespace: 'CumulusDistribution'
  };
  pRetry(() => metricExists(params), {
    retries: 10
  });
};

describe('The distributionMetrics endpoint', () => {
  it('retrieves no errors or successes on a "new stack" when no metrics have been published yet', async () => {
    const response = await distributionMetrics({
      prefix: config.stackName,
      stackName
    });
    const result = JSON.parse(response.body);
    const expected = { errors: '0', successes: '0' };
    expect(result).toEqual(expected);
  });

  describe('Ignores custom metrics older than one day.', () => {
    let now;
    let twelveHoursAgo;
    let twoDaysAgo;
    let twentyFiveHoursAgo;
    const errorsTwentyFiveHoursAgo = Math.floor(Math.random() * 10);
    const successesTwentyFiveHoursAgo = Math.floor(Math.random() * 10);
    const twentyFiveHoursInMs = 25 * 60 * 60 * 1000;
    const twelveHoursInMs = 12 * 60 * 60 * 1000;
    const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;

    beforeAll(async () => {
      now = new Date(new Date(Date.now()).setSeconds(0, 0));
      twentyFiveHoursAgo = new Date(now - twentyFiveHoursInMs);
      const successMetric = buildMetricDataObject(
        'SuccessCount',
        stackName,
        twentyFiveHoursAgo,
        successesTwentyFiveHoursAgo
      );
      const errorMetric = buildMetricDataObject(
        'ErrorCount',
        stackName,
        twentyFiveHoursAgo,
        errorsTwentyFiveHoursAgo
      );

      await Promise.all([
        putMetricDataObject([successMetric]),
        putMetricDataObject([errorMetric])
      ]);

      await Promise.all([
        metricAvailableInCloudwatch(successMetric),
        metricAvailableInCloudwatch(errorMetric)
      ]);
    });

    it('ignores old Metrics', async () => {
      const expected = { errors: '0', successes: '0' };
      const response = await distributionMetrics({
        prefix: config.stackName,
        stackName
      });
      const result = JSON.parse(response.body);
      expect(result).toEqual(expected);
    });
  });
});
