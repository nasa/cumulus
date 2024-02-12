const { randomId } = require('@cumulus/common/test-utils');

/** Typical resonse from cloudwatch.getMetrics()  */
const getMetricDatasResult = {
  ResponseMetadata: {
    RequestId: '535bb868-7cb7-11e9-91f1-771c6077cbeb',
  },
  MetricDataResults: [
    {
      Id: 'id590a38dc92',
      Label: 'SuccessCount',
      Timestamps: ['2019-05-21T17:30:00.000Z', '2019-05-19T17:30:00.000Z'],
      Values: [3, 11],
      StatusCode: 'Complete',
      Messages: [],
    },
  ],
  Messages: [],
};

/** Typical Response from AWS.APIGateway.getStages */
const getStagesResult = {
  item: [
    {
      deploymentId: randomId('deploymentId'),
      stageName: 'dev',
      cacheClusterEnabled: false,
      cacheClusterStatus: 'NOT_AVAILABLE',
      methodSettings: {},
      tracingEnabled: false,
      createdDate: '2019-05-17T23:35:00.000Z',
      lastUpdatedDate: '2019-05-20T23:17:00.000Z',
    },
    {
      deploymentId: randomId('deploymentId'),
      stageName: 'prod',
      cacheClusterEnabled: false,
      cacheClusterStatus: 'NOT_AVAILABLE',
      methodSettings: {},
      tracingEnabled: false,
      createdDate: '2019-05-17T23:25:18.000Z',
      lastUpdatedDate: '2019-05-20T23:07:52.000Z',
    },
  ],
};

/** Typical array of objects used as input to cloudwatch.getMetricData */
const getMetricDatasInput = [
  {
    MetricDataQueries: [
      {
        Id: 'fakeIdValue',
        MetricStat: {
          Metric: {
            Namespace: 'AWS/ApiGateway',
            MetricName: '4XXError',
            Dimensions: [
              {
                Name: 'ApiName',
                Value: 'stackname-distribution',
              },
              {
                Name: 'Stage',
                Value: 'dev',
              },
            ],
          },
          Period: 86400,
          Stat: 'Sum',
          Unit: 'Count',
        },
      },
    ],
    ScanBy: 'TimestampDescending',
    StartTime: new Date('2019-05-09T21:54:00.000Z'),
    EndTime: new Date('2019-05-10T21:54:00.000Z'),
  },
];

/**Typical output from cloudwatch.listMetrics */
const listMetricsResult = {
  ResponseMetadata: {
    RequestId: 'aaf7435b-7cca-11e9-ac94-e370d994b57c',
  },
  Metrics: [
    {
      Namespace: 'AWS/ApiGateway',
      MetricName: '4XXError',
      Dimensions: [
        {
          Name: 'ApiName',
          Value: 'stackname-distribution',
        },
        {
          Name: 'Stage',
          Value: 'dev',
        },
      ],
    },
  ],
};

module.exports = {
  getMetricDatasInput,
  getMetricDatasResult,
  getStagesResult,
  listMetricsResult,
};
