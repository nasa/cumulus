'use strict';

const flatten = require('lodash.flatten');
const router = require('express-promise-router')();

const {
  aws: { cloudwatch, apigateway },
  testUtils: { randomId }
} = require('@cumulus/common');

/**
 * @param {Array<numbers>} array
 * @returns {number} sum of values in array
 */
const sumArray = (array) => array.reduce((accum, cur) => accum + cur, 0);

const callGetStages = (restApiId) =>
  apigateway()
    .getStages({ restApiId })
    .promise();

/**
 *
 * @param {Object} getStagesResult - return value of aws.apigateway.getStages on a given apiId
 * @returns {Array<string>} - list of stage names associated with the apiId
 */
const parseStagesResult = (getStagesResult) =>
  getStagesResult.item.map((i) => i.stageName);

/**
 * Get a list of the all stages associated with the url's api Gateway.
 *
 * @param {string} restApiId - api endpoint where the first part of the host is the restApiId.
 * @returns {Promise<Array>} - array of names of stages found on api gateway.
 */
const getApiStages = (restApiId) =>
  callGetStages(restApiId).then(parseStagesResult);

/**
 * Lists all stages associated with the backend and distribution api urls.
 */
const listAllStages = async () => {
  const apiId = process.env.distributionApiId;
  return getApiStages(apiId);
};

/**
 * Returns the name of the stage used in the cumulus deployment.
 */
const getStageName = async () => {
  const stages = Array.from(new Set(await listAllStages()));
  if (stages.length !== 1) {
    throw new Error(
      `cumulus configured with wrong number of stages: ${stages.length}`
    );
  }
  return stages[0];
};

/**
 * create MetricData Queries for calling to getMetricData
 *
 * @param {Date} StartTime - Starting Date for Metric Query
 * @param {Date} EndTime - Endting Date for Metric Query
 * param {Object} Metric - Single item from the Metric array of a successful
 *                          CloudWatch.listMetrics call
 * @returns {<Object>} - metricDataQuery object
 */
const buildGetMetricParams = (StartTime, EndTime) => (Metric) => ({
  MetricDataQueries: [
    {
      Id: randomId('id'),
      MetricStat: {
        Metric,
        Period: 60 * 60 * 24, // seconds in day
        Stat: 'Sum',
        Unit: 'Count'
      }
    }
  ],
  ScanBy: 'TimestampDescending',
  StartTime,
  EndTime
});

/**
 * builds the metric data parameters for a list of input metrics.
 *
 * @param {Array<Metrics>} listMetricsResult
 * @returns {Promise<Array>} - Promise of results array.
 */
const buildGetMetricParamsFromListMetricsResult = (listMetricsResult) => {
  const oneDayInMs = 8.64e7;
  const EndTime = new Date(new Date(Date.now()).setSeconds(0, 0));
  const StartTime = new Date(EndTime - oneDayInMs);

  return listMetricsResult.Metrics.map(
    buildGetMetricParams(StartTime, EndTime)
  );
};

/**
 * calls cloudwatch.getMetricData for a single parameters object.
 * @param {Object} params - input params
 * @returns {Promise<Object>} - Promise for a getMetricData result.
 */
const getMetricDatum = (params) =>
  cloudwatch()
    .getMetricData(params)
    .promise();

const getMetricData = (listOfParams) =>
  Promise.all(listOfParams.map(getMetricDatum));

const callListMetrics = (params) =>
  cloudwatch()
    .listMetrics(params)
    .promise();

/**
 * Return the array Values from the metric, or [0] if no Values are found
 *
 * @param {Object} metric - array for a single metric from getMetric (which
 *         collects calls to cloudwatch.getMetricData)
 * @returns {Array<numbers>} - results in metric's Values, or [0]
 */
const valuesFromMetric = (metric) => {
  try {
    return metric.MetricDataResults[0].Values;
  } catch (error) {
    return [0];
  }
};

const valuesFromMetrics = (metrics) => flatten(metrics.map(valuesFromMetric));

const getSumOfMetric = (listMetricParams) =>
  callListMetrics(listMetricParams)
    .then(buildGetMetricParamsFromListMetricsResult)
    .then(getMetricData)
    .then(valuesFromMetrics)
    .then(sumArray);

/**
 * Get the CloudWatch metricList for Cumulus' private namespace and desired MetricName.
 *
 * @param {string} stackName
 * @param {string} MetricName - desired metric.
 * @returns {Promise<Array>} - Promise for Array of CloudWatch metrics.
 */
const customListMetricsParam = (stackName, MetricName) => ({
  MetricName,
  Namespace: 'CumulusDistribution',
  Dimensions: [{ Name: 'Stack', Value: stackName }]
});

const customErrorListMetricsParam = (stackName) =>
  customListMetricsParam(stackName, 'FailureCount');

const customSuccessListMetricsParam = (stackName) =>
  customListMetricsParam(stackName, 'SuccessCount');

/**
 *  Return an object suitable for querying cloudwatch.listMetrics
 *
 * @param {string} stackName - Stack name
 * @param {string} stageName - apiStage name
 * @param {string} MetricName - desired metric
 * @returns {<Object>} listMetric input parameter object
 */
const buildListMetricsParams = (stackName, stageName, MetricName) => ({
  MetricName,
  Dimensions: [
    { Name: 'ApiName', Value: `${stackName}-distribution` },
    { Name: 'Stage', Value: `${stageName}` }
  ],
  Namespace: 'AWS/ApiGateway'
});

/**
 * get total errors for the stackName and errorType
 * @param {string} stackName
 * @param {string} errorType metric name for Error
 * @returns {number} total errors on distribution APIs for the last 24 hours
 */
const apiErrorsCount = async (stackName, errorType) => {
  const stageName = await getStageName(stackName);
  return getSumOfMetric(
    buildListMetricsParams(stackName, stageName, errorType)
  );
};

const apiUserErrorsCount = (stackName) => apiErrorsCount(stackName, '4XXError');

const apiServerErrorsCount = (stackName) =>
  apiErrorsCount(stackName, '5XXError');

const s3AccessErrorsCount = (stackname) =>
  getSumOfMetric(customErrorListMetricsParam(stackname));

const s3AccessSuccessCount = (stackName) =>
  getSumOfMetric(customSuccessListMetricsParam(stackName));

const combinedResults = (
  userErrors,
  serverErrors,
  accessErrors,
  accessSuccesses
) => ({
  errors: String(userErrors + serverErrors + accessErrors),
  successes: String(accessSuccesses)
});

const getDistributionMetrics = async (stackName) => {
  const [
    apiUserErrors,
    apiServerErrors,
    s3AccessErrors,
    s3AccessSuccess
  ] = await Promise.all([
    apiUserErrorsCount(stackName),
    apiServerErrorsCount(stackName),
    s3AccessErrorsCount(stackName),
    s3AccessSuccessCount(stackName)
  ]);

  return combinedResults(
    apiUserErrors,
    apiServerErrors,
    s3AccessErrors,
    s3AccessSuccess
  );
};

async function get(req, res) {
  const stackName = req.params.stackName || process.env.stackName;
  const metrics = await getDistributionMetrics(stackName);
  return res.send(metrics);
}

router.get('/:stackName?', get);
module.exports = router;
