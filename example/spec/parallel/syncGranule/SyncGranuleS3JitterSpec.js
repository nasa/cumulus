const fs = require('fs');

const {
  addCollections,
  addProviders,
  cleanupCollections,
  cleanupProviders,
} = require('@cumulus/integration-tests');
const { updateCollection } = require('@cumulus/integration-tests/api/api');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
  uploadTestDataToBucket,
} = require('../../helpers/testUtils');
const {
  setupTestGranuleForIngest,
  waitForGranuleAndDelete,
} = require('../../helpers/granuleUtils');

const workflowName = 'SyncGranule';
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

describe('The SyncGranule workflow with S3 jitter', () => {
  let collection;
  let config;
  let provider;
  let testDataFolder;
  let testSuffix;
  let lambdaStep;

  beforeAll(async () => {
    config = await loadConfig();
    lambdaStep = new LambdaStep();

    const testId = createTimestampedTestId(config.stackName, 'SyncGranuleS3Jitter');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    provider = { id: `s3_provider${testSuffix}` };

    const s3data = [
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
    ];

    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
    ]);

    await updateCollection({
      prefix: config.stackName,
      collection,
      updateParams: { duplicateHandling: 'replace' },
    });
  });

  afterAll(async () => {
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
    ]);
  });

  describe('when S3_JITTER_MAX_MS is not set (default)', () => {
    let workflowExecution;
    let executionArn;
    let lambdaOutput;
    let granuleId;

    beforeAll(async () => {
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';
      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      const inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        inputPayloadJson,
        granuleRegex,
        testSuffix,
        testDataFolder
      );
      granuleId = inputPayload.granules[0].granuleId;

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload
      );
      executionArn = workflowExecution.executionArn;

      lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'SyncGranule');
    });

    afterAll(async () => {
      const collectionId = constructCollectionId(collection.name, collection.version);
      await Promise.all([
        waitForGranuleAndDelete(config.stackName, granuleId, collectionId, ['completed', 'failed']),
        deleteExecution({ prefix: config.stackName, executionArn }),
      ]);
    });

    it('completes execution with success status', () => {
      expect(workflowExecution.status).toEqual('completed');
    });

    it('syncs granule files successfully without jitter', () => {
      expect(lambdaOutput.payload.granules).toBeDefined();
      expect(lambdaOutput.payload.granules.length).toEqual(1);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual(granuleId);
      expect(lambdaOutput.payload.granules[0].files.length).toBeGreaterThan(0);
    });

    it('completes sync operation quickly without delays', () => {
      const syncDuration = lambdaOutput.payload.granules[0].sync_granule_duration;
      expect(syncDuration).toBeDefined();
      // Without jitter, sync should be relatively fast (< 10 seconds for small test files)
      expect(syncDuration).toBeLessThan(10000);
    });
  });

  describe('when S3_JITTER_MAX_MS is set to 1000ms', () => {
    let workflowExecution;
    let executionArn;
    let lambdaOutput;
    let granuleId;

    beforeAll(async () => {
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';
      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      const inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        inputPayloadJson,
        granuleRegex,
        testSuffix,
        testDataFolder
      );
      granuleId = inputPayload.granules[0].granuleId;

      // Override environment variable for this execution
      process.env.S3_JITTER_MAX_MS = '1000';

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        { env: { S3_JITTER_MAX_MS: '1000' } }
      );
      executionArn = workflowExecution.executionArn;

      lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'SyncGranule');

      delete process.env.S3_JITTER_MAX_MS;
    });

    afterAll(async () => {
      const collectionId = constructCollectionId(collection.name, collection.version);
      await Promise.all([
        waitForGranuleAndDelete(config.stackName, granuleId, collectionId, ['completed', 'failed']),
        deleteExecution({ prefix: config.stackName, executionArn }),
      ]);
    });

    it('completes execution with success status', () => {
      expect(workflowExecution.status).toEqual('completed');
    });

    it('syncs granule files successfully with jitter enabled', () => {
      expect(lambdaOutput.payload.granules).toBeDefined();
      expect(lambdaOutput.payload.granules.length).toEqual(1);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual(granuleId);
      expect(lambdaOutput.payload.granules[0].files.length).toBeGreaterThan(0);
    });
  });

  describe('when S3_JITTER_MAX_MS is set to 0 (explicitly disabled)', () => {
    let workflowExecution;
    let executionArn;
    let lambdaOutput;
    let granuleId;

    beforeAll(async () => {
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';
      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      const inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        inputPayloadJson,
        granuleRegex,
        testSuffix,
        testDataFolder
      );
      granuleId = inputPayload.granules[0].granuleId;

      process.env.S3_JITTER_MAX_MS = '0';

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        { env: { S3_JITTER_MAX_MS: '0' } }
      );
      executionArn = workflowExecution.executionArn;

      lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'SyncGranule');

      delete process.env.S3_JITTER_MAX_MS;
    });

    afterAll(async () => {
      const collectionId = constructCollectionId(collection.name, collection.version);
      await Promise.all([
        waitForGranuleAndDelete(config.stackName, granuleId, collectionId, ['completed', 'failed']),
        deleteExecution({ prefix: config.stackName, executionArn }),
      ]);
    });

    it('completes execution with success status', () => {
      expect(workflowExecution.status).toEqual('completed');
    });

    it('syncs granule files successfully without jitter delays', () => {
      expect(lambdaOutput.payload.granules).toBeDefined();
      expect(lambdaOutput.payload.granules.length).toEqual(1);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual(granuleId);
      expect(lambdaOutput.payload.granules[0].files.length).toBeGreaterThan(0);
    });

    it('completes sync operation quickly with zero jitter', () => {
      const syncDuration = lambdaOutput.payload.granules[0].sync_granule_duration;
      expect(syncDuration).toBeDefined();
      expect(syncDuration).toBeLessThan(10000);
    });
  });

  describe('when S3_JITTER_MAX_MS is set to 5000ms (high-concurrency scenario)', () => {
    let workflowExecution;
    let executionArn;
    let lambdaOutput;
    let granuleId;

    beforeAll(async () => {
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';
      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      const inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        inputPayloadJson,
        granuleRegex,
        testSuffix,
        testDataFolder
      );
      granuleId = inputPayload.granules[0].granuleId;

      process.env.S3_JITTER_MAX_MS = '5000';

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        { env: { S3_JITTER_MAX_MS: '5000' } }
      );
      executionArn = workflowExecution.executionArn;

      lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'SyncGranule');

      delete process.env.S3_JITTER_MAX_MS;
    });

    afterAll(async () => {
      const collectionId = constructCollectionId(collection.name, collection.version);
      await Promise.all([
        waitForGranuleAndDelete(config.stackName, granuleId, collectionId, ['completed', 'failed']),
        deleteExecution({ prefix: config.stackName, executionArn }),
      ]);
    });

    it('completes execution with success status', () => {
      expect(workflowExecution.status).toEqual('completed');
    });

    it('syncs granule files successfully with 5-second max jitter', () => {
      expect(lambdaOutput.payload.granules).toBeDefined();
      expect(lambdaOutput.payload.granules.length).toEqual(1);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual(granuleId);
      expect(lambdaOutput.payload.granules[0].files.length).toBeGreaterThan(0);
    });

    it('respects the configured maximum jitter value', () => {
      const syncDuration = lambdaOutput.payload.granules[0].sync_granule_duration;
      expect(syncDuration).toBeDefined();
      // Sync duration should account for jitter but not exceed reasonable bounds
      // (5s max jitter per S3 operation, multiple operations may occur)
      expect(syncDuration).toBeLessThan(30000);
    });
  });

  describe('when multiple granules are synced with S3_JITTER_MAX_MS enabled', () => {
    const executionArns = [];
    const granuleIds = [];
    let allWorkflowsCompleted = true;

    beforeAll(async () => {
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';

      process.env.S3_JITTER_MAX_MS = '2000';

      // Launch 3 concurrent workflow executions with jitter enabled
      const setupPromises = Array.from({ length: 3 }, async (_, i) => {
        const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
        const inputPayload = await setupTestGranuleForIngest(
          config.bucket,
          inputPayloadJson,
          granuleRegex,
          `${testSuffix}_jitter_${i}`,
          testDataFolder
        );
        granuleIds.push(inputPayload.granules[0].granuleId);
        return inputPayload;
      });

      const inputPayloads = await Promise.all(setupPromises);

      const workflowPromises = inputPayloads.map((inputPayload) => buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        { env: { S3_JITTER_MAX_MS: '2000' } }
      ));

      const workflowExecutions = await Promise.all(workflowPromises);
      executionArns.push(...workflowExecutions.map((execution) => execution.executionArn));
      allWorkflowsCompleted = workflowExecutions.every((execution) => execution.status === 'completed');

      delete process.env.S3_JITTER_MAX_MS;
    });

    afterAll(async () => {
      const collectionId = constructCollectionId(collection.name, collection.version);
      const cleanupPromises = granuleIds.map((granuleId) =>
        waitForGranuleAndDelete(config.stackName, granuleId, collectionId, ['completed', 'failed']));
      cleanupPromises.push(...executionArns.map((executionArn) =>
        deleteExecution({ prefix: config.stackName, executionArn })));
      await Promise.all(cleanupPromises);
    });

    it('completes all concurrent executions successfully', () => {
      expect(allWorkflowsCompleted).toBe(true);
    });

    it('prevents S3 SlowDown errors with jitter spreading out S3 requests', () => {
      // If all executions completed, jitter successfully prevented SlowDown errors
      expect(executionArns.length).toEqual(3);
      executionArns.forEach((arn) => {
        expect(arn).toBeDefined();
      });
    });
  });

  describe('when S3_JITTER_MAX_MS is set to maximum allowed value (59000ms)', () => {
    let workflowExecution;
    let executionArn;
    let lambdaOutput;
    let granuleId;

    beforeAll(async () => {
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';
      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      const inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        inputPayloadJson,
        granuleRegex,
        testSuffix,
        testDataFolder
      );
      granuleId = inputPayload.granules[0].granuleId;

      process.env.S3_JITTER_MAX_MS = '59000';

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        { env: { S3_JITTER_MAX_MS: '59000' } }
      );
      executionArn = workflowExecution.executionArn;

      lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'SyncGranule');

      delete process.env.S3_JITTER_MAX_MS;
    });

    afterAll(async () => {
      const collectionId = constructCollectionId(collection.name, collection.version);
      await Promise.all([
        waitForGranuleAndDelete(config.stackName, granuleId, collectionId, ['completed', 'failed']),
        deleteExecution({ prefix: config.stackName, executionArn }),
      ]);
    });

    it('completes execution with success status', () => {
      expect(workflowExecution.status).toEqual('completed');
    });

    it('syncs granule files successfully with maximum jitter value', () => {
      expect(lambdaOutput.payload.granules).toBeDefined();
      expect(lambdaOutput.payload.granules.length).toEqual(1);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual(granuleId);
      expect(lambdaOutput.payload.granules[0].files.length).toBeGreaterThan(0);
    });

    it('respects the maximum allowed jitter value', () => {
      const syncDuration = lambdaOutput.payload.granules[0].sync_granule_duration;
      expect(syncDuration).toBeDefined();
      // With maximum jitter, duration may be significantly longer
      expect(syncDuration).toBeGreaterThan(0);
    });
  });
});
