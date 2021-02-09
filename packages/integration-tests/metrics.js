/* eslint-disable no-await-in-loop */

const { cloudwatch } = require('@cumulus/aws-client/services');
const pWaitFor = require('p-wait-for');

/**
* Aggregates a single statistic metric
* @summary Takes a Cloudwatch metrics object and returns an appropriately aggregated query result,
* depending on query type:
*
* @param {Object} queryObject - Cloudwatch metrics query object
* @param {function} cloudwatchFunction - cloudwatch aws-client service to use.
*                        Defaults to included `cloudwatch`
* @returns {number} - Returns the requested statistic
*/
const getAggregateMetricQuery = async (queryObject, cloudwatchFunction = cloudwatch) => {
  const response = await cloudwatchFunction().getMetricStatistics(queryObject).promise();
  console.log(JSON.stringify(response));
  if (response.NextToken) {
    throw new Error('Test returned an unexpectedly large stats value');
  }
  if (queryObject.Statistics[0] === 'Average') {
    return response.Datapoints.reduce((a, c) => (a > c.Average ? a : c.Average), 0);
  }
  if (queryObject.Statistics[0] === 'Sum') {
    return response.Datapoints.reduce((a, c) => (a + c.Sum), 0);
  }
  if (queryObject.Statistics[0] === 'Minimum') {
    return response.Datapoints.reduce((a, c) => ((a && a <= c.Minimum) ? a : c.Minimum), 0);
  }
  if (queryObject.Statistics[0] === 'Maximum') {
    return response.Datapoints.reduce((a, c) => (a > c.Maximum ? a : c.Maximum), 0);
  }
  return response;
};

/**
* Takes a lambda and waits for metrics invocation counts to stabilize, returns invocations
* @summary Takes a lambda and queries metrics for an invocation count, waiting until the count
* stabilizes, expecting it will at least have minCount, and stabilize once
* that minimum reaches, or return no matter what once maxCount has been reached
* @param {Object} params - method parameters
* @param {string} params.minCount - Minimum invocation count to wait for
* @param {string} params.maxCount - Maximum invocation count to wait for
* @param {string} params.timeout - Timeout (ms) to allow function to wait for
* invocations to complete
* @param {Date} params.beginTime - Date to start metrics query
* @param {function} params.getAggregateMetricQuery - Optional override to
* getAggregateMetricQuery for units
* @returns {number} Lambda invocation count
*/
const getInvocationCount = async (params) => {
  const {
    aggregateMetricQueryFunction = getAggregateMetricQuery,
    beginTime,
    interval = 30 * 1000,
    lambda,
    maxCount,
    minCount,
    timeout,
  } = params;

  let dbInvocationCount = 0;
  let invokeCounts = [0];

  await pWaitFor(async () => {
    dbInvocationCount = await aggregateMetricQueryFunction({
      EndTime: new Date(),
      MetricName: 'Invocations',
      Namespace: 'AWS/Lambda',
      Period: 120,
      StartTime: beginTime,
      Statistics: ['Sum'],
      Dimensions: [{ Name: 'FunctionName', Value: lambda }],
    });
    if (dbInvocationCount) {
      invokeCounts.push(dbInvocationCount);
      invokeCounts = invokeCounts.slice(-6);
    }
    return (dbInvocationCount >= maxCount ||
      (((invokeCounts.reduce((a, b) => a + b) / invokeCounts.length) >= (dbInvocationCount * 0.9))
      && dbInvocationCount >= minCount));
  }, { interval, timeout });
  return dbInvocationCount;
};

module.exports = {
  getInvocationCount,
  getAggregateMetricQuery,
};
