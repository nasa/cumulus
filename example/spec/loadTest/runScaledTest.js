'use strict';

/* eslint-disable no-await-in-loop */

const path = require('path');
const fs = require('fs');
const pWaitFor = require('p-wait-for');

const { randomString } = require('@cumulus/common/test-utils');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { cloudwatch } = require('@cumulus/aws-client/services');
const { listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const { providers, collections, granules } = require('@cumulus/api-client');

const {
  buildAndExecuteWorkflow,
  api: apiTestUtils,
} = require('@cumulus/integration-tests');

const {
  createTestSuffix,
  createTimestampedTestId,
  loadConfig,
} = require('../helpers/testUtils');
//const provider_path = 'ingest_1_test_2';
//const provider_path = 'ingest_100_test_2';
// eslint-disable-next-line camelcase
const provider_path = 'ingest_1_test';
const batches = 3;
const expectedGranuleCount = 1;
const expectedMaxInvocationCount = expectedGranuleCount * batches; // Number of Ingest workflow invocations.
const publishGranulesMinInvocations = (expectedGranuleCount * batches) / 10; // Number of publish invocations to require to pass metrics.
const publishExecutionsMinInvocations = (expectedGranuleCount * batches) / 10; // Number of execution publish invocations to require to pass metrics
const waitForIngestTimoutMs = 5 * 60 * 1000;
const rdsClusterName = process.env.rdsClusterName || 'cumulus-dev-rds-cluster';

const ingestedCollectionGranules = {};
const testCollections = [];
let beforeAllCompleted;
let bucket;
let config;
let provider;
let stackName;
let workflowExecution;

const testBeginTime = new Date(Date.now() - 60000);

const generateMetricsQueryObject = (params) => {
  const {
    Dimensions,
    EndTime,
    lambda,
    MetricName,
    Namespace,
    Period,
    StartTime,
    Statistics,
  } = params;

  return {
    Dimensions: Dimensions || [{ Name: 'FunctionName', Value: lambda }],
    EndTime,
    MetricName,
    Namespace,
    Period,
    StartTime,
    Statistics,
  };
};

const getAggregateMetricQuery = async (queryObject) => {
  const response = await cloudwatch().getMetricStatistics(queryObject).promise();
  console.log(JSON.stringify(response));
  if (response.NextToken) {
    throw new Error('Test returned an unexpectedly large stats value');
  }
  if (queryObject.Statistics[0] === 'Average') {
    return response.Datapoints.reduce((a, c) => (a + c.Average), 0) / response.Datapoints.length;
  }
  if (queryObject.Statistics[0] === 'Sum') {
    return response.Datapoints.reduce((a, c) => (a + c.Sum), 0);
  }
  if (queryObject.Statistics[0] === 'Minimum') {
    return response.Datapoints.reduce((a, c) => (a <= c.Minimum ? a : c.Minimum), 0);
  }
  if (queryObject.Statistics[0] === 'Maximum') {
    return response.Datapoints.reduce((a, c) => (a > c.Maximum ? a : c.Maximum), 0);
  }
  return response;
};

const getInvocationCount = async (lambda, minCount, maxCount) => {
  let dbInvocationCount = 0;
  let invocationCounts = [0];
  while (
    (dbInvocationCount < maxCount &&
    (invocationCounts.reduce((a, b) => a + b) / invocationCounts.length) < (dbInvocationCount * 0.9)) ||
    dbInvocationCount < minCount
  ) { // improve this with retry
    dbInvocationCount = await getAggregateMetricQuery(generateMetricsQueryObject({
      EndTime: new Date(),
      lambda,
      MetricName: 'Invocations',
      Namespace: 'AWS/Lambda',
      Period: 120,
      StartTime: testBeginTime,
      Statistics: ['Sum'],
    }));
    console.log(`${lambda} Invocation Count: ${dbInvocationCount}`);
    console.log(`invocationCounts Metric: ${invocationCounts.reduce((a, b) => a + b) / invocationCounts.length}`);
    console.log(`invocationCounts: ${invocationCounts}`);
    if (dbInvocationCount) {
      invocationCounts.push(dbInvocationCount);
      invocationCounts = invocationCounts.slice(-6);
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  return dbInvocationCount;
};

const checkGranuleCount = async (granuleCollection) => {
  console.log(`Using collection ${granuleCollection.name}___${granuleCollection.version}`);
  let granuleFiles;
  await pWaitFor(async () => {
    granuleFiles = await listS3ObjectsV2({
      // TODO fix ___
      Prefix: `${granuleCollection.name}___${granuleCollection.version}`,
      Bucket: config.buckets.protected.name,
    });
    console.log(`Granules found: ${granuleFiles.length}`);
    return granuleFiles.length === expectedGranuleCount;
  },
  { interval: 10000, timeout: waitForIngestTimoutMs });
  return granuleFiles;
};

describe('The Ingest Load Test', () => {
  beforeAll(async () => {
    try {
      config = await loadConfig();
      stackName = config.stackName;
      bucket = config.bucket;
      process.env.system_bucket = config.bucket;
      process.env.ProvidersTable = `${stackName}-ProvidersTable`;
      process.env.PdrsTable = `${stackName}-PdrsTable`;
      process.env.ExecutionsTable = `${stackName}-ExecutionsTable`;
      process.env.GranulesTable = `${stackName}-GranulesTable`;
      let workflowCount = 0;
      let granuleCount = 0;

      const testId = createTimestampedTestId(stackName, 'IngestGranuleSuccess');

      const collectionTemplate = JSON.parse(fs.readFileSync(
        path.join(__dirname, '/collection/s3_loadtest_MOD09GQ_006L.json'),
        'utf8'
      ));

      const testSuffix = createTestSuffix(testId);
      provider = {
        id: `s3_provider${testSuffix}`,
        host: 'cumulus-sandbox-fake-s3-provider',
        protocol: 's3',
        globalConnectionLimit: 1000,
      };

      while (workflowCount < batches) {
        const collection = { ...collectionTemplate };
        collection.name += `_${randomString()}`;

        await collections.createCollection({ prefix: stackName, collection });
        await providers.createProvider({ prefix: stackName, provider });
        testCollections.push(collection);

        console.log('Starting ingest executions');
        // Create Rule or manually invoke Discover Granules
        workflowExecution = await buildAndExecuteWorkflow(
          stackName,
          bucket,
          'DiscoverGranules',
          collection,
          provider,
          undefined,
          { provider_path }
        );
        await (new LambdaStep()).getStepOutput(
          workflowExecution.executionArn,
          'QueueGranules'
        );
        const ingestedGranules = await checkGranuleCount(collection);
        console.log(`Ingested ${ingestedGranules.length} granules in batch ${workflowCount}`);
        ingestedCollectionGranules[collection.name] = ingestedGranules;
        workflowCount += 1;
      }
      beforeAllCompleted = true;
    } catch(error) {
      console.log(error);
      throw error;
    }
  });

  afterAll(async () => {
    try {
      const deleteCollectionPromises = testCollections.slice.map((testCollection) => {
        const collectionGranuleNames = ingestedCollectionGranules[testCollection.name];
        const granIds = collectionGranuleNames.map((g) => g.Key.split('\/').pop().replace(/hdf$/, ''));// TODO - method?
        return granules.bulkDeleteGranules({ prefix: stackName, body: { ids: granIds } });
      });
      const bulkDeletionResponses = await Promise.all(deleteCollectionPromises);
      const deleteQueryPromises = bulkDeletionResponses.map(async (bulkDeleteResponse) =>
        pWaitFor(async () => {
          console.log(`Async operation: ${JSON.stringify(bulkDeleteResponse)}`);
          const asyncId = JSON.parse(bulkDeleteResponse.body).id;
          let asyncOperation = {};
          try {
            asyncOperation = await apiTestUtils.getAsyncOperation({
              prefix: stackName,
              id: asyncId,
            });
          } catch (error) {
            return false;
          }
          if (!asyncOperation.body) {
            return false;
          }
          if (['RUNNER_FAILED', 'TASK_FAILED'].includes(JSON.parse(asyncOperation.body).status)) {
            console.log('here2');
            throw new Error(`Cleanup failed on delete granules async operation ${JSON.stringify(asyncOperation.body)}`);
          }
          return JSON.parse(asyncOperation.body).status === 'SUCCEEDED';
        }, { interval: 60 * 1000, timeout: 15 * 60 * 1000 }));

      await Promise.all(deleteQueryPromises);
      console.log('Granule deletion succeeded!');

      await providers.deleteProvider({ prefix: stackName, provider: provider.id });
      const deleteCollectionsPromises = testCollections.map((collection) => {
        return collections.deleteCollection({
          prefix: stackName,
          collectionName: collection.name,
          collectionVersion: collection.version,
        });
      });
      await Promise.all(deleteCollectionsPromises);
    } catch (error) {
      console.log(`Warning -- cleanup didn't complete: ${JSON.stringify(error)}`);
      throw error;
    }
  });

  it('executes successfully', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(workflowExecution.status).toEqual('SUCCEEDED');
  });
/*
  it('writes to database occur within a reasonable time frame and error count', async () => {
    const lambda = `${stackName}-sfEventSqsToDbRecords`;
    // Check granules have been updated
    const dbInvocationCount = await getInvocationCount(lambda, 4, (expectedMaxInvocationCount * 2) + 1);
    const EndTime = new Date();
    const Period = 120;
    const queryObject = {
      EndTime,
      lambda,
      Namespace: 'AWS/Lambda',
      Period,
      StartTime: testBeginTime,
    };

    const dbThrottleCount = await getAggregateMetricQuery(
      generateMetricsQueryObject(({
        ...queryObject,
        MetricName: 'Throttles',
        Statistics: ['Sum'],
      }))
    );
    const dbErrorCount = await getAggregateMetricQuery(
      generateMetricsQueryObject(({
        ...queryObject,
        MetricName: 'Errors',
        Statistics: ['Sum'],
      }))
    );
    const durationAverage = await getAggregateMetricQuery(
      generateMetricsQueryObject(({
        ...queryObject,
        MetricName: 'Duration',
        Statistics: ['Average'],
      }))
    );

    expect(dbInvocationCount).toBeGreaterThan(3);
    expect(dbThrottleCount).toBe(0);
    expect(dbErrorCount).toBeLessThan(expectedGranuleCount * 0.01);
    expect(durationAverage).toBeLessThan(7000);
  });

  it('triggers the granules publish lambda and completes with no errors/throttling', async () => {
    const lambda = `${config.stackName}-publishGranules`;
    const EndTime = new Date();
    const invocationCount = await getInvocationCount(lambda, 2, expectedMaxInvocationCount * 2);
    const queryObject = {
      Namespace: 'AWS/Lambda',
      lambda,
      StartTime: testBeginTime,
      EndTime,
      Statistics: ['Sum'],
      Period: 120,
    };

    const dbThrottleCount = await getAggregateMetricQuery(
      generateMetricsQueryObject({
        ...queryObject,
        MetricName: 'Throttles',
      })
    );

    const dbErrorCount = await getAggregateMetricQuery(
      generateMetricsQueryObject({
        ...queryObject,
        MetricName: 'Errors',
      })
    );

    expect(invocationCount).toBeGreaterThan(publishGranulesMinInvocations); // Checking for interference
    expect(dbThrottleCount).toBe(0);
    expect(dbErrorCount).toBe(0);
  });

  it('triggers the execution publish lambda and completes with no errors/throttling', async () => {
    const lambda = `${config.stackName}-publishExecutions`;
    const invocationCount = await getInvocationCount(lambda, 2, expectedMaxInvocationCount * 2);
    const EndTime = new Date();
    const queryObject = {
      Namespace: 'AWS/Lambda',
      lambda,
      StartTime: testBeginTime,
      EndTime,
      Statistics: ['Sum'],
      Period: 120,
    };
    const dbThrottleCount = await getAggregateMetricQuery(
      generateMetricsQueryObject({
        ...queryObject,
        MetricName: 'Throttles',
      })
    );
    const dbErrorCount = await getAggregateMetricQuery(
      generateMetricsQueryObject({
        ...queryObject,
        MetricName: 'Errors',
      })
    );

    expect(invocationCount).toBeGreaterThan(publishExecutionsMinInvocations); // Checking for interference
    expect(dbThrottleCount).toBe(0);
    expect(dbErrorCount).toBe(0);
  });

  it('does not cause the stack configured database to exceed predefined tolerances', async () => {
    const queryObject = {
      Namespace: 'AWS/RDS',
      StartTime: testBeginTime,
      EndTime: new Date(),
      Period: 60 * 3,
      Dimensions: [{
        Name: 'DBClusterIdentifier',
        Value: rdsClusterName,
      }],
    };

    const dbCpuMaximum = await getAggregateMetricQuery(
      generateMetricsQueryObject({
        ...queryObject,
        MetricName: 'CPUUtilization',
        Statistics: ['Maximum'],
      })
    );

    const dbCapacity = await getAggregateMetricQuery(
      generateMetricsQueryObject({
        ...queryObject,
        MetricName: 'dbCapacity',
        Statistics: ['Maximum'],
      })
    );

    const diskQueueDepth = await getAggregateMetricQuery(
      generateMetricsQueryObject({
        ...queryObject,
        MetricName: 'diskQueueDepth',
        Statistics: ['Maximum'],
      })
    );

    const dbConnections = await getAggregateMetricQuery(
      generateMetricsQueryObject({
        ...queryObject,
        MetricName: 'DatabaseConnections',
        Statistics: ['Maximum'],
      })
    );
    expect(diskQueueDepth).toBe(0);
    expect(dbCpuMaximum).toBeLessThan(80);
    expect(dbCapacity).toBeLessThan(3);
    expect(dbConnections).toBeLessThan(120);
  }); */
});
