/* eslint-disable no-await-in-loop */

'use strict';

const path = require('path');
const fs = require('fs');
const pWaitFor = require('p-wait-for');

const { getAggregateMetricQuery, getInvocationCount } = require('@cumulus/integration-tests/metrics');
const { generateIterableTestDirectories } = require('@cumulus/integration-tests/utils');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const { collections, granules, providers } = require('@cumulus/api-client');
const { randomString } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { api: apiTestUtils } = require('@cumulus/integration-tests');
const { buildAndExecuteWorkflow } = require('../helpers/workflowUtils');

const {
  createTestSuffix,
  createTimestampedTestId,
  loadConfig,
} = require('../helpers/testUtils');

// ** Configurable Variables

const expectedGranuleCount = 500; // Per batch -- requires pre-generation of batch directories in target dir
const batches = 3; // Number of batches to run
const providerPathTemplate = `ingest_${expectedGranuleCount}_test`; // Directory pattern to use
const providerPaths = generateIterableTestDirectories(providerPathTemplate, batches); // Given N batches, run over "pattern_0-9,a-z" directories

// Tuneable stats timeout values
const waitForIngestTimeoutMs = 6 * 60 * 1000; // Timeout(ms) for each batch's files o show up in S3
const statsTimeout = 240 * 1000; // Timeout(ms) for lambda invocations to stabilize
const granuleCountThreshold = 0.95; // Percent granules to count as a successful batch on ingest timeout

// sf_event_sqs_to_db_records lambda test configuration

const dbLambdaErrorThreshold = 0.03; // Max % errors allowed during test
const dbLambdaMaxThrottleCountThreshold = 1; // Max throttles allowed alarm threshold
const dbLambdaDurationMaxThreshold = 7000; // Max *average* duration test alarm threshold

// RDS cluster test configuration

const rdsCommitLatencyThreshold = 10; // Commit latency threshold
const rdsDiskQueueDepthThreshold = 10;// Queue depth threshold
const rdsCpuMaximumThreshold = 80; // DB Cluster cpu max threshold
const rdsDbCapacityThreshold = 3; // RDS ACU capacity threshold
const rdsConnectionsThreshold = 140; // Max connections threshold

const expectedMaxWorkflowInvocation = expectedGranuleCount * providerPaths.length; // Number of Ingest workflow invocations.
const publishGranulesMinInvocations = (expectedGranuleCount * providerPaths.length) / 10; // Number of publish invocations to require to pass metrics.
const publishExecutionsMinInvocations = (expectedGranuleCount * providerPaths.length) / 10; // Number of execution publish invocations to require to pass metrics

const rdsClusterName = process.env.rdsClusterName || 'cumulus-dev-rds-cluster';
const testCollections = [];
let allIngestedGranules = [];
let beforeAllCompleted;
let bucket;
let testConfig;
let provider;
let stackName;
let workflowExecution;

const testBeginTime = new Date(Date.now() - 60000);
jasmine.DEFAULT_TIMEOUT_INTERVAL = process.env.LOAD_TEST_TIMEOUT || 4200000;

const checkGranuleCount = async (granuleCollection, config, count) => {
  console.log(`Using collection ${constructCollectionId(granuleCollection.name, granuleCollection.version)}`);
  let prevGranuleFilesCount;
  let granuleFiles = [];
  try {
    await pWaitFor(async () => {
      prevGranuleFilesCount = granuleFiles.length;
      granuleFiles = await listS3ObjectsV2({
        Prefix: constructCollectionId(granuleCollection.name, granuleCollection.version),
        Bucket: config.buckets.protected.name,
      });
      console.log(`Ingested granules found: ${granuleFiles.length}`);
      if (granuleFiles.length > count) {
        console.log(`Test misconfiguration detected - ${granuleFiles.length} granules are present when there should be max ${count}`);
        return true;
      }
      return granuleFiles.length === count && prevGranuleFilesCount === count;
    },
    { interval: 20000, timeout: waitForIngestTimeoutMs });
  } catch (error) {
    if (error.name !== 'TimeoutError') {
      throw error;
    }
    console.log(`Full Granules not ingested: ${prevGranuleFilesCount}`);
  }
  return granuleFiles;
};

describe('The Ingest Load Test', () => {
  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
    bucket = config.bucket;
    process.env.system_bucket = config.bucket;
    process.env.GranulesTable = `${stackName}-GranulesTable`;
    let workflowCount = 0;

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

    await providers.createProvider({ prefix: stackName, provider });
    while (workflowCount < providerPaths.length) {
      // Create collection for this batch
      const collection = { ...collectionTemplate };
      collection.name += `_${randomString()}`;
      await collections.createCollection({ prefix: stackName, collection });
      testCollections.push(collection);

      console.log(`Starting ingest execution for batch ${workflowCount + 1}/${providerPaths.length}`);
      workflowExecution = await buildAndExecuteWorkflow(
        stackName,
        bucket,
        'DiscoverGranules',
        collection,
        provider,
        undefined,
        { provider_path: providerPaths[workflowCount] }
      );
      await (new LambdaStep()).getStepOutput(
        workflowExecution.executionArn,
        'QueueGranules'
      );
      const ingestedGranules = await checkGranuleCount(collection, config, expectedGranuleCount);
      if (ingestedGranules.length < expectedGranuleCount * granuleCountThreshold) {
        throw new Error(`Aborting, counts too low on test run ${workflowCount}`);
      }
      allIngestedGranules = allIngestedGranules.concat(ingestedGranules);
      console.log(`Ingested ${ingestedGranules.length} granules in batch ${workflowCount + 1}`);
      workflowCount += 1;
    }
    testConfig = config;
    beforeAllCompleted = true;
  });

  afterAll(async () => {
    const granIds = allIngestedGranules.map((g) => g.Key.split('\/').pop().replace(/\.hdf$/, ''));
    const bulkDeleteResponse = await granules.bulkDeleteGranules({ prefix: stackName, body: { ids: granIds } });
    const responseBody = JSON.parse(bulkDeleteResponse.body);
    if (responseBody.status !== 'RUNNING') {
      throw new Error(`Cleanup Failed - async operations returned ${JSON.stringify(responseBody)}`);
    }

    await pWaitFor(async () => {
      console.log(`\nAsync operation: ${JSON.stringify(bulkDeleteResponse)}`);
      let asyncOperation = {};
      try {
        asyncOperation = await apiTestUtils.getAsyncOperation({
          prefix: testConfig.stackName,
          id: responseBody.id,
        });
      } catch (error) {
        return false;
      }
      if (!asyncOperation.body) {
        return false;
      }
      if (['RUNNER_FAILED', 'TASK_FAILED'].includes(JSON.parse(asyncOperation.body).status)) {
        throw new Error(`Cleanup failed on delete granules async operation ${JSON.stringify(asyncOperation.body)}`);
      }
      return JSON.parse(asyncOperation.body).status === 'SUCCEEDED';
    }, { interval: 10 * 1000, timeout: 15 * 60 * 1000 });

    console.log('Bulk deletion succeeded!');

    await providers.deleteProvider({ prefix: stackName, providerId: provider.id });
    const deleteCollectionsPromises = testCollections.map((collection) => collections.deleteCollection({
      prefix: stackName,
      collectionName: collection.name,
      collectionVersion: collection.version,
    }));
    await Promise.all(deleteCollectionsPromises);
  });

  it('writes to database occur within a reasonable time frame and error count', async () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      const lambda = `${stackName}-sfEventSqsToDbRecords`;
      // Check granules have been updated
      const dbInvocationCount = await getInvocationCount({
        beginTime: testBeginTime,
        lambda,
        maxCount: (expectedMaxWorkflowInvocation * 2) + 1,
        minCount: 4,
        timeout: statsTimeout,
      });
      console.log(`Invocation count is ${dbInvocationCount}`);
      const EndTime = new Date();
      const Period = 120;
      const queryObject = {
        EndTime,
        Namespace: 'AWS/Lambda',
        Period,
        StartTime: testBeginTime,
        Dimensions: [{ Name: 'FunctionName', Value: lambda }],
      };

      const dbThrottleCount = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'Throttles',
        Statistics: ['Sum'],
      });
      const dbErrorCount = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'Errors',
        Statistics: ['Sum'],
      });
      const durationAverage = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'Duration',
        Period: (Math.round(((EndTime.getTime() - testBeginTime.getTime()) / 60000)) + 1) * 60,
        Statistics: ['Average'],
      });

      expect(dbInvocationCount).toBeGreaterThan(3);
      expect(dbThrottleCount).toBeLessThan(dbLambdaMaxThrottleCountThreshold);
      expect(dbErrorCount).toBeLessThan(expectedGranuleCount * dbLambdaErrorThreshold);
      expect(durationAverage).toBeLessThan(dbLambdaDurationMaxThreshold);
    }
  });

  it('triggers the granules publish lambda and completes with no errors/throttling', async () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      const lambda = `${testConfig.stackName}-publishGranules`;
      const EndTime = new Date();
      const invocationCount = await getInvocationCount({
        beginTime: testBeginTime,
        lambda,
        maxCount: expectedMaxWorkflowInvocation * 2,
        minCount: 2,
        timeout: statsTimeout,
      });
      const queryObject = {
        Namespace: 'AWS/Lambda',
        StartTime: testBeginTime,
        EndTime,
        Statistics: ['Sum'],
        Period: 120,
        Dimensions: [{ Name: 'FunctionName', Value: lambda }],
      };

      const throttleCount = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'Throttles',
      });

      const errorCount = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'Errors',
      });
      console.log(`Counts:  Invocations: ${invocationCount}, throttleCount ${throttleCount}, rrrorCount: ${errorCount}`);
      expect(invocationCount).toBeGreaterThan(publishGranulesMinInvocations); // Checking for interference
      expect(throttleCount).toBe(0);
      expect(errorCount).toBe(0);
    }
  });

  it('triggers the execution publish lambda and completes with no errors/throttling', async () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      const lambda = `${testConfig.stackName}-publishExecutions`;
      const invocationCount = await getInvocationCount({
        beginTime: testBeginTime,
        lambda,
        maxCount: expectedMaxWorkflowInvocation * 2,
        minCount: 2,
        timeout: statsTimeout,
      });
      const EndTime = new Date();
      const queryObject = {
        Namespace: 'AWS/Lambda',
        StartTime: testBeginTime,
        EndTime,
        Statistics: ['Sum'],
        Period: 120,
        Dimensions: [{ Name: 'FunctionName', Value: lambda }],
      };
      const throttleCount = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'Throttles',
      });
      const errorCount = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'Errors',
      });

      console.log(`Counts:  Invocations: ${invocationCount}, throttleCount ${throttleCount}, errorCount: ${errorCount}`);
      expect(invocationCount).toBeGreaterThan(publishExecutionsMinInvocations); // Checking for interference
      expect(throttleCount).toBe(0);
      expect(errorCount).toBe(0);
    }
  });

  it('does not cause the stack configured database to exceed predefined tolerances', async () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      const EndTime = new Date();
      const queryObject = {
        Namespace: 'AWS/RDS',
        StartTime: testBeginTime,
        EndTime,
        Period: 60 * 3,
        Dimensions: [{
          Name: 'DBClusterIdentifier',
          Value: rdsClusterName,
        }],
      };

      const dbCpuMaximum = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'CPUUtilization',
        Statistics: ['Maximum'],
      });

      const dbCapacity = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'ServerlessDatabaseCapacity',
        Statistics: ['Maximum'],
      });

      const diskQueueDepth = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'DiskQueueDepth',
        Statistics: ['Maximum'],
      });

      const rdsCommitLatency = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'CommitLatency',
        Statistics: ['Average'],
        Period: (Math.round(((EndTime.getTime() - testBeginTime.getTime()) / 60000)) + 1) * 60,
      });

      const dbConnections = await getAggregateMetricQuery({
        ...queryObject,
        MetricName: 'DatabaseConnections',
        Statistics: ['Maximum'],
      });

      expect(rdsCommitLatency).toBeLessThan(rdsCommitLatencyThreshold);
      expect(diskQueueDepth).toBeLessThan(rdsDiskQueueDepthThreshold);
      expect(dbCpuMaximum).toBeLessThan(rdsCpuMaximumThreshold);
      expect(dbCapacity).toBeLessThan(rdsDbCapacityThreshold);
      expect(dbConnections).toBeLessThan(rdsConnectionsThreshold);
    }
  });
});
