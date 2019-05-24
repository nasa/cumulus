'use strict';

const AWS = require('aws-sdk');
const pRetry = require('p-retry');

const {
  testUtils: { randomId },
  util: { sleep }
} = require('@cumulus/common');

const {
  api: { distributionMetrics }
} = require('@cumulus/integration-tests');

const { loadConfig } = require('../../helpers/testUtils');
const config = loadConfig();
const sleepTimeInMs = 180 * 1000; // 2:00 wait
const oneHourInMs = 60 * 60 * 1000;
const oneMinuteInMs = 60 * 1000;
const aRandomNumber = () => Math.floor(Math.random() * 990) + 10;
const cloudwatch = new AWS.CloudWatch();
const stackName = randomId('ZZZ');

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

const listMetricData = (params) => cloudwatch.listMetrics(params).promise();

const getMetricData = (params) => cloudwatch.getMetricData(params).promise();

const buildGetMetricDataParam = (Metric) => {
  const EndTime = new Date(new Date(Date.now()).setSeconds(0, 0));
  const StartTime = new Date(EndTime - 24 * oneHourInMs);

  return {
    MetricDataQueries: [
      {
        Id: randomId('id'),
        MetricStat: {
          Metric,
          Period: 60 * 60 * 24, // 3 hours in seconds
          Stat: 'Sum',
          Unit: 'Count'
        }
      }
    ],
    ScanBy: 'TimestampDescending',
    StartTime,
    EndTime
  };
};

const add = (a, b) => a + b;
/**
 * Throw error if the retrieved metrics count don't match the expected metrics count.
 */
const validateMetricDataResults = (metricDataResult, metricDataObject) => {
  const expectedCount = metricDataObject.Value;
  const actualCount = metricDataResult.MetricDataResults[0].Values.reduce(
    add,
    0
  );
  if (expectedCount !== actualCount) {
    throw new Error('All Metrics not settled...retry');
  }
  console.log(`METRICS SETTLED ${metricDataObject.MetricName}`);
};

/**
 * Throws error if expected MetricData is not found in cloudwatch api
 */
const metricDataExists = async (metricDataObject) => {
  const params = {
    MetricName: metricDataObject.MetricName,
    Dimensions: metricDataObject.Dimensions,
    Namespace: 'CumulusDistribution'
  };

  const metrics = await listMetricData(params);
  if (metrics.Metrics.length === 0) {
    throw new Error('Metric not found...retry');
  }
  const metricData = await getMetricData(
    buildGetMetricDataParam(metrics.Metrics[0])
  );
  return validateMetricDataResults(metricData, metricDataObject);
};

const waitForMetricToBeAvailableInCloudwatch = async (metricDataObject) => {
  await pRetry(() => metricDataExists(metricDataObject), {
    retries: 10,
    minTimeout: 30 * 1000,
    onFailedAttempt: (error) => {
      console.log(
        `Attempt ${error.attemptNumber} failed. There are ${
          error.attemptsLeft
        } attempts left.`
      );
    }
  });
};

const putCloudwatchMetrics = async (whenDate, successCounts, errorCounts) => {
  const successMetric = buildMetricDataObject(
    'SuccessCount',
    stackName,
    whenDate,
    successCounts
  );
  const errorMetric = buildMetricDataObject(
    'FailureCount',
    stackName,
    whenDate,
    errorCounts
  );

  await Promise.all([
    putMetricDataObject([successMetric]),
    putMetricDataObject([errorMetric])
  ]);
  return [successMetric, errorMetric];
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

  describe('Retrieves expected Metrics.', () => {
    let twoHoursAgo;
    const twoHoursInMs = 2 * oneHourInMs;
    const twoHourSuccesses = aRandomNumber();
    const twoHourErrors = aRandomNumber();

    beforeAll(async () => {
      const now = new Date(new Date(Date.now()).setSeconds(0, 0));
      twoHoursAgo = new Date(now - twoHoursInMs);
      const [successMetrics, errorMetrics] = await putCloudwatchMetrics(
        twoHoursAgo,
        twoHourSuccesses,
        twoHourErrors
      );
      await Promise.all([
        waitForMetricToBeAvailableInCloudwatch(successMetrics),
        waitForMetricToBeAvailableInCloudwatch(errorMetrics)
      ]);
      await sleep(sleepTimeInMs);
    });

    it('finds metrics from the previous 24 hours', async () => {
      const expected = {
        errors: String(twoHourErrors),
        successes: String(twoHourSuccesses)
      };
      const response = await distributionMetrics({
        prefix: config.stackName,
        stackName
      });
      const result = JSON.parse(response.body);
      expect(result).toEqual(expected);
    });

    describe('multiple metrics values in cloudwatch.', () => {
      const newSuccesses = aRandomNumber();
      const newErrors = aRandomNumber();

      beforeAll(async () => {
        const now = new Date(new Date(Date.now()).setSeconds(0, 0));
        const tenMinutesAgo = new Date(now - 10 * oneMinuteInMs);

        const [successMetrics, errorMetrics] = await putCloudwatchMetrics(
          tenMinutesAgo,
          newSuccesses,
          newErrors
        );

        // we want to validate the total metrics are available.
        successMetrics.Value = twoHourSuccesses + newSuccesses;
        errorMetrics.Value = twoHourErrors + newErrors;
        await Promise.all([
          waitForMetricToBeAvailableInCloudwatch(successMetrics),
          waitForMetricToBeAvailableInCloudwatch(errorMetrics)
        ]);
        await sleep(sleepTimeInMs);
      });

      it('computes sums of metrics', async () => {
        const expected = {
          errors: String(twoHourErrors + newErrors),
          successes: String(twoHourSuccesses + newSuccesses)
        };
        const response = await distributionMetrics({
          prefix: config.stackName,
          stackName
        });
        const result = JSON.parse(response.body);
        expect(result).toEqual(expected);
      });
    });
  });
});
