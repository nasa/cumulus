'use strict';

const AWS = require('aws-sdk');
const pRetry = require('p-retry');
const isEqual = require('lodash.isequal');

const {
  testUtils: { randomId }
} = require('@cumulus/common');

const {
  api: { distributionMetrics }
} = require('@cumulus/integration-tests');

const { loadConfig } = require('../../helpers/testUtils');
const config = loadConfig();
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

// Upload a list of Metric Data to CloudWatch
const putMetricDataObject = (MetricData) =>
  cloudwatch
    .putMetricData({
      Namespace: 'CumulusDistribution',
      MetricData
    })
    .promise();

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
};

/**
 * Because the cloudwatch metrics are eventually consistent, we have to try to
 * get them with a retry until we get the results we expect.
 *
 * @param {Object} expected - expected API results from previous test setup.
 * @returns {Object} Api result matching the expected input.
 */
const callApiUntilWeGetTheCorrectValue = async (expected) =>
  pRetry(
    async () => {
      const response = await distributionMetrics({
        prefix: config.stackName,
        stackName
      });
      const result = JSON.parse(response.body);
      if (!isEqual(expected, result)) {
        throw new Error('Metric not constent...Retry');
      }
      return result;
    },
    {
      retries: 10,
      onFailedAttempt: (error) =>
        console.log(
          `Waiting for CloudWatch metrics consistency ${
            error.attemptsLeft
          } remaining`
        )
    }
  );

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
    const twoHourSuccesses = aRandomNumber();
    const twoHourErrors = aRandomNumber();

    beforeAll(async () => {
      const now = new Date(new Date(Date.now()).setSeconds(0, 0));
      const twoHoursAgo = new Date(now - 2 * oneHourInMs);
      await putCloudwatchMetrics(twoHoursAgo, twoHourSuccesses, twoHourErrors);
    });

    it('finds metrics from the previous 24 hours', async () => {
      const expected = {
        errors: String(twoHourErrors),
        successes: String(twoHourSuccesses)
      };

      const result = await callApiUntilWeGetTheCorrectValue(expected);
      expect(result).toEqual(expected);
    });

    describe('correctly interprets multiple metrics values.', () => {
      const newSuccesses = aRandomNumber();
      const newErrors = aRandomNumber();

      beforeAll(async () => {
        const now = new Date(new Date(Date.now()).setSeconds(0, 0));
        const tenMinutesAgo = new Date(now - 10 * oneMinuteInMs);
        await putCloudwatchMetrics(tenMinutesAgo, newSuccesses, newErrors);
      });

      it('computes sums of metrics', async () => {
        const expected = {
          errors: String(twoHourErrors + newErrors),
          successes: String(twoHourSuccesses + newSuccesses)
        };
        const result = await callApiUntilWeGetTheCorrectValue(expected);
        expect(result).toEqual(expected);
      });
    });
  });
});
