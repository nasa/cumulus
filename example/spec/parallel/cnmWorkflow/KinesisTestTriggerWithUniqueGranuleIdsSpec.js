'use strict';

const crypto = require('crypto');

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const isMatch = require('lodash/isMatch');
const path = require('path');
const replace = require('lodash/replace');
const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const {
  getQueueUrlByName,
} = require('@cumulus/aws-client/SQS');
const { getWorkflowFileKey } = require('@cumulus/common/workflows');
const fs = require('fs');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 9 * 60 * 1000;

const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  getEventSourceMapping,
  addRules,
  waitForCompletedExecution,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  readJsonFilesFromDir,
  deleteRules,
  setProcessEnvironment,
  getExecutionInputObject,
} = require('@cumulus/integration-tests');
const { getExecution, deleteExecution } = require('@cumulus/api-client/executions');
const { getGranule, removePublishedGranule } = require('@cumulus/api-client/granules');
const { randomString } = require('@cumulus/common/test-utils');
const { getExecutionUrlFromArn } = require('@cumulus/message/Executions');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  waitForApiRecord,
  waitForApiStatus,
} = require('../../helpers/apiUtils');
const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
} = require('../../helpers/testUtils');

const {
  createOrUseTestStream,
  deleteTestStream,
  getShardIterator,
  getStreamStatus,
  getRecords,
  putRecordOnStream,
  tryCatchExit,
  waitForActiveStream,
  waitForTestSfForRecord,
} = require('../../helpers/kinesisHelpers');

const testWorkflow = 'CNMExampleWorkflow';

// When kinesis-type rules exist, the Cumulus lambda messageConsumer is
// configured to trigger workflows when new records arrive on a Kinesis
// stream. When a record appears on the stream, the messageConsumer lambda
// triggers workflows associated with the kinesis-type rules.
describe('The Cloud Notification Mechanism Kinesis workflow with Unique GranuleIds', () => {
  const collectionsDir = './data/collections/L2_HR_PIXC-000-unique/';
  const collectionsDir2 = './data/collections/L2_HR_PIXC-099/';
  const maxWaitForExecutionSecs = 60 * 5;
  const maxWaitForSFExistSecs = 60 * 4;
  const providersDir = './data/providers/PODAAC_SWOT/';

  let cnmResponseStreamName;
  let duplicateExecutionStatus;
  let duplicateRecordDifferentCollection;
  let duplicateRecordIdentifier;
  let duplicateRuleDirectory;
  let duplicateRuleOverride;
  let duplicateWorkflowExecution;
  let executionNamePrefix;
  let expectedSyncGranulesPayload;
  let expectedTranslatePayload;
  let failingWorkflowExecution;
  let fileData;
  let initialExecutionStatus;
  let initialRecord;
  let initialRuleDirectory;
  let initialRuleOverride;
  let initialWorkflowExecution;
  let lambdaStep;
  let logEventSourceMapping;
  let producerGranuleId;
  let recordFile;
  let recordIdentifier;
  let responseStreamShardIterator;
  let ruleSuffix;
  let scheduleQueueUrl;
  let streamName;
  let testConfig;
  let testDataFolder;
  let testSuffix;
  let uniqueGranuleId1;
  let uniqueGranuleIdDuplicate;
  let uniqueGranuleIdError;
  let workflowArn;

  async function cleanUp() {
    setProcessEnvironment(testConfig.stackName, testConfig.bucket);

    const initialRule = await readJsonFilesFromDir(initialRuleDirectory);
    const duplicateRule = await readJsonFilesFromDir(duplicateRuleDirectory);

    console.log(`\nDeleting rules ${initialRuleOverride.name}`);
    await Promise.all([
      deleteRules(testConfig.stackName, testConfig.bucket, initialRule, ruleSuffix),
      deleteRules(testConfig.stackName, testConfig.bucket, duplicateRule, ruleSuffix),
    ]);

    console.log('\nDeleting executions');
    await Promise.all([
      deleteExecution({ prefix: testConfig.stackName, executionArn: failingWorkflowExecution.executionArn }),
      deleteExecution({ prefix: testConfig.stackName, executionArn: initialWorkflowExecution.executionArn }),
      deleteExecution({ prefix: testConfig.stackName, executionArn: duplicateWorkflowExecution.executionArn }),
    ]);

    console.log('\nDeleting Granules');
    await Promise.all([
      removePublishedGranule({
        prefix: testConfig.stackName,
        granuleId: uniqueGranuleId1,
        collectionId: constructCollectionId(initialRuleOverride.collection.name, initialRuleOverride.collection.version),
      }),
      removePublishedGranule({
        prefix: testConfig.stackName,
        granuleId: uniqueGranuleIdDuplicate,
        collectionId: constructCollectionId(duplicateRuleOverride.collection.name, duplicateRuleOverride.collection.version),
      }),
      removePublishedGranule({
        prefix: testConfig.stackName,
        granuleId: uniqueGranuleIdError,
        collectionId: constructCollectionId(initialRuleOverride.collection.name, initialRuleOverride.collection.version),
      }),
    ]);

    console.log('\nDeleting Collections');
    await Promise.all([
      cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDir2, testSuffix),
    ]);

    console.log('\nDeleting S3 data, streams, and providers');
    await Promise.all([
      deleteFolder(testConfig.bucket, testDataFolder),
      deleteTestStream(streamName),
      deleteTestStream(cnmResponseStreamName),
      cleanupProviders(testConfig.stackName, testConfig.bucket, providersDir, testSuffix),
    ]);
  }

  beforeAll(async () => {
    testConfig = await loadConfig();
    const testId = createTimestampedTestId(testConfig.stackName, 'KinesisTestTriggerUnique');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);
    ruleSuffix = replace(testSuffix, /-/g, '_');

    const workflowDefinition = await getJsonS3Object(
      testConfig.bucket,
      getWorkflowFileKey(testConfig.stackName, testWorkflow)
    );
    workflowArn = workflowDefinition.arn;

    initialRecord = JSON.parse(fs.readFileSync(`${__dirname}/data/records/L2_HR_PIXC_product_0001-of-4154.json`));

    initialRecord.product.files[0].uri = replace(
      initialRecord.product.files[0].uri,
      /<replace-bucket>\/cumulus-test-data\/pdrs/g,
      `${testConfig.bucket}/${testDataFolder}`
    );
    initialRecord.provider += testSuffix;
    initialRecord.collection += testSuffix;
    initialRecord.product.name += testSuffix;

    // uniqueGranuleId1 will be uniquified
    uniqueGranuleId1 = initialRecord.product.name;
    producerGranuleId = initialRecord.product.name;
    recordIdentifier = `granule1_${randomString()}`;
    initialRecord.identifier = recordIdentifier;

    lambdaStep = new LambdaStep();

    recordFile = initialRecord.product.files[0];
    expectedTranslatePayload = {
      granules: [
        {
          granuleId: initialRecord.product.name,
          version: initialRecord.product.dataVersion,
          dataType: initialRecord.collection,
          files: [
            {
              source_bucket: testConfig.bucket,
              name: recordFile.name,
              type: recordFile.type,
              bucket: testConfig.bucket,
              path: testDataFolder,
              url_path: recordFile.uri,
              size: recordFile.size,
              checksumType: recordFile.checksumType,
              checksum: recordFile.checksum,
              fileName: recordFile.name,
              key: path.join(testDataFolder, recordFile.name),
            },
          ],
        },
      ],
    };

    fileData = expectedTranslatePayload.granules[0].files[0];

    const fileDataWithFilename = {
      bucket: testConfig.buckets.private.name,
      key: 'key_placeholder',
      fileName: recordFile.name,
      size: fileData.size,
      type: recordFile.type,
      checksumType: recordFile.checksumType,
      checksum: recordFile.checksum,
      source: `${testDataFolder}/${recordFile.name}`,
    };

    expectedSyncGranulesPayload = {
      granuleDuplicates: {},
      granules: [
        {
          producerGranuleId: initialRecord.product.name,
          dataType: initialRecord.collection,
          version: '000',
          files: [fileDataWithFilename],
        },
      ],
    };

    executionNamePrefix = randomString(3);

    scheduleQueueUrl = await getQueueUrlByName(`${testConfig.stackName}-backgroundProcessing`);

    initialRuleDirectory = './spec/parallel/cnmWorkflow/data/rules/kinesis/';
    initialRuleOverride = {
      name: `L2_HR_PIXC_kinesisRule${ruleSuffix}`,
      collection: {
        name: initialRecord.collection,
        version: '000',
      },
      provider: initialRecord.provider,
      executionNamePrefix,
      // use custom queue for scheduling workflows
      queueUrl: scheduleQueueUrl,
    };

    const s3data = ['@cumulus/test-data/granules/L2_HR_PIXC_product_0001-of-4154.h5'];

    streamName = `${testId}-KinesisTestTriggerStream`;
    cnmResponseStreamName = `${testId}-KinesisTestTriggerCnmResponseStream`;
    testConfig.streamName = streamName;
    testConfig.cnmResponseStream = cnmResponseStreamName;

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(testConfig.bucket, s3data, testDataFolder),
      addCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      addProviders(testConfig.stackName, testConfig.bucket, providersDir, testConfig.bucket, testSuffix),
    ]);
    // create streams
    await tryCatchExit(cleanUp, async () => {
      await Promise.all([
        createOrUseTestStream(streamName),
        createOrUseTestStream(cnmResponseStreamName),
      ]);
      console.log(`\nWaiting for active streams: '${streamName}' and '${cnmResponseStreamName}'.`);
      await Promise.all([
        waitForActiveStream(streamName),
        waitForActiveStream(cnmResponseStreamName),
      ]);
      const ruleList = await addRules(testConfig, initialRuleDirectory, initialRuleOverride);
      logEventSourceMapping = await getEventSourceMapping(ruleList[0].rule.logEventArn);
    });
  });

  afterAll(async () => {
    await cleanUp();
  });

  it('Creates an event to log incoming records', () => {
    const mapping = logEventSourceMapping;
    expect(mapping.FunctionArn.endsWith(`${testConfig.stackName}-KinesisInboundEventLogger`)).toBeTrue();
    expect(mapping.EventSourceArn.endsWith(streamName)).toBeTrue();
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    expect(await getStreamStatus(streamName)).toBe('ACTIVE');
  });

  describe('Workflow executes successfully', () => {
    beforeAll(async () => {
      await tryCatchExit(cleanUp, async () => {
        console.log(`Dropping initialRecord onto  ${streamName}, recordIdentifier: ${recordIdentifier}`);
        await putRecordOnStream(streamName, initialRecord);

        console.log('Waiting for step function to start...');
        initialWorkflowExecution = await waitForTestSfForRecord(recordIdentifier, workflowArn, maxWaitForSFExistSecs);

        console.log(`Waiting for completed execution of ${initialWorkflowExecution.executionArn}`);
        initialExecutionStatus = await waitForCompletedExecution(initialWorkflowExecution.executionArn, maxWaitForExecutionSecs);
      });
    });

    it('executes successfully', () => {
      expect(initialExecutionStatus).toEqual('SUCCEEDED');
    });

    it('creates an execution with the correct prefix', () => {
      const executionName = initialWorkflowExecution.executionArn.split(':').reverse()[0];
      expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
    });

    it('references the correct queue URL in the execution message', async () => {
      const executionInput = await getExecutionInputObject(initialWorkflowExecution.executionArn);
      expect(executionInput.cumulus_meta.queueUrl).toBe(scheduleQueueUrl);
    });

    describe('the TranslateMessage Lambda', () => {
      let lambdaOutput;
      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(initialWorkflowExecution.executionArn, 'CNMToCMA');
      });

      it('outputs the expectedTranslatePayload object', () => {
        expect(lambdaOutput.payload).toEqual(expectedTranslatePayload);
      });

      it('maps the CNM object correctly', () => {
        expect(lambdaOutput.meta.cnm.receivedTime).not.toBeNull();
        delete lambdaOutput.meta.cnm.receivedTime;

        expect(lambdaOutput.meta.cnm).toEqual({
          product: initialRecord.product,
          identifier: recordIdentifier,
          provider: initialRecord.provider,
          collection: initialRecord.collection,
          submissionTime: initialRecord.submissionTime,
          version: initialRecord.version,
        });
      });
    });

    describe('the execution record', () => {
      let startStep;
      let endStep;
      beforeAll(async () => {
        startStep = await lambdaStep.getStepInput(initialWorkflowExecution.executionArn, 'CNMToCMA');
        endStep = await lambdaStep.getStepOutput(initialWorkflowExecution.executionArn, 'CnmResponse');
      });

      it('records both the original and the final payload', async () => {
        const executionRecord = await waitForApiStatus(
          getExecution,
          {
            prefix: testConfig.stackName,
            arn: initialWorkflowExecution.executionArn,
          },
          'completed'
        );
        expect(executionRecord.originalPayload).toEqual(startStep.payload);
        expect(executionRecord.finalPayload).toEqual(endStep.payload);
      });
    });

    describe('the AddUniqueGranuleId Lambda', () => {
      let lambdaOutput;
      let granule;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(initialWorkflowExecution.executionArn, 'AddUniqueGranuleId');
        granule = lambdaOutput.payload.granules[0];
        // uniqueGranuleId1 is uniquified
        uniqueGranuleId1 = granule.granuleId;
        console.log(`AddUniqueGranuleId returns uniqueGranuleId1: ${uniqueGranuleId1}, producerGranuleId: ${granule.producerGranuleId}`);
      });

      it('outputs the granules object', () => {
        expect(granule.producerGranuleId).toEqual(producerGranuleId);
        expect(granule.granuleId).not.toEqual(producerGranuleId);
        expect(granule.granuleId).toBeTruthy();
        expect(granule.granuleId).toMatch(
          new RegExp(`^${producerGranuleId}_[a-zA-Z0-9-]+$`)
        );
      });
    });

    describe('the SyncGranule Lambda', () => {
      let lambdaOutput;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(initialWorkflowExecution.executionArn, 'SyncGranule');
      });

      it('outputs the granules object', () => {
        const filePrefix = `file-staging/${testConfig.stackName}/${initialRecord.collection}___000/${crypto.createHash('md5').update(uniqueGranuleId1).digest('hex')}`;
        expectedSyncGranulesPayload.granules[0].files[0].key = `${filePrefix}/${recordFile.name}`;
        const updatedExpectedPayload = {
          ...expectedSyncGranulesPayload,
          granules: [
            {
              ...expectedSyncGranulesPayload.granules[0],
              granuleId: uniqueGranuleId1,
              sync_granule_duration: lambdaOutput.payload.granules[0].sync_granule_duration,
              createdAt: lambdaOutput.payload.granules[0].createdAt,
              provider: initialRecord.provider,
            },
          ],
        };
        expect(lambdaOutput.payload).toEqual(updatedExpectedPayload);
      });
    });

    describe('the CnmResponse Lambda', () => {
      let lambdaOutput;
      let granule;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(initialWorkflowExecution.executionArn, 'CnmResponse');

        granule = await waitForApiRecord(
          getGranule,
          {
            prefix: testConfig.stackName,
            granuleId: uniqueGranuleId1,
            collectionId: constructCollectionId(initialRuleOverride.collection.name, initialRuleOverride.collection.version),
          },
          {
            status: 'completed',
            execution: getExecutionUrlFromArn(initialWorkflowExecution.executionArn),
          }
        );
      });

      it('outputs the expected object', () => {
        const actualPayload = lambdaOutput.payload;
        expect(actualPayload.granules.length).toBe(1);
        expect(actualPayload.granules[0].granuleId).toBe(uniqueGranuleId1);
      });

      it('writes a message to the response stream', async () => {
        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'`);
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);
        const newResponseStreamRecords = await getRecords(responseStreamShardIterator);
        const parsedRecords = newResponseStreamRecords.map((r) => JSON.parse(new TextDecoder().decode(r.Data)));
        const responseRecord = parsedRecords.find((r) => r.identifier === recordIdentifier);
        expect(responseRecord.identifier).toEqual(recordIdentifier);
        expect(responseRecord.response.status).toEqual('SUCCESS');
        expect(responseRecord).toEqual(lambdaOutput.meta.cnmResponse);
      });

      it('puts cnmResponse to cumulus message for granule record', () => {
        const expectedCnmResponse = {
          version: initialRecord.version,
          submissionTime: initialRecord.submissionTime,
          collection: initialRecord.collection,
          provider: initialRecord.provider,
          identifier: initialRecord.identifier,
          product: {
            dataVersion: initialRecord.product.dataVersion,
            name: initialRecord.product.name,
          },
          response: {
            status: 'SUCCESS',
          },
        };

        const cnmResponse = get(lambdaOutput, 'meta.granule.queryFields.cnm');
        expect(isMatch(cnmResponse, expectedCnmResponse)).toBe(true);
        expect(cnmResponse.product.files.length).toBe(2);
        expect(get(granule, 'queryFields.cnm')).toEqual(cnmResponse);
      });
    });
  });

  describe('granule in a separate collection with the same producerGranuleId is ingested successfully', () => {
    beforeAll(async () => {
      await addCollections(testConfig.stackName, testConfig.bucket, collectionsDir2, testSuffix);

      duplicateRecordDifferentCollection = JSON.parse(fs.readFileSync(`${__dirname}/data/records/L2_HR_PIXC_product_0001-of-4154_dupe.json`));
      duplicateRecordDifferentCollection.product.files[0].uri = replace(
        duplicateRecordDifferentCollection.product.files[0].uri,
        /<replace-bucket>\/cumulus-test-data\/pdrs/g,
        `${testConfig.bucket}/${testDataFolder}`
      );
      duplicateRecordDifferentCollection.provider += testSuffix;
      duplicateRecordDifferentCollection.collection += testSuffix;
      duplicateRecordDifferentCollection.product.name += testSuffix;

      duplicateRecordIdentifier = `granule2_${randomString()}`;
      duplicateRecordDifferentCollection.identifier = duplicateRecordIdentifier;

      // Create new rule for new collection
      duplicateRuleDirectory = './spec/parallel/cnmWorkflow/data/rules/kinesis/duplicate/';
      duplicateRuleOverride = {
        name: `L2_HR_PIXC_DUPLICATE_kinesisRule${ruleSuffix}`,
        collection: {
          name: duplicateRecordDifferentCollection.collection,
          version: '099',
        },
        provider: duplicateRecordDifferentCollection.provider,
        executionNamePrefix,
        // use custom queue for scheduling workflows
        queueUrl: scheduleQueueUrl,
      };

      await addRules(testConfig, duplicateRuleDirectory, duplicateRuleOverride);

      await tryCatchExit(cleanUp, async () => {
        console.log(`Dropping second record onto  ${streamName}, duplicateRecordIdentifier: ${duplicateRecordIdentifier}`);
        await putRecordOnStream(streamName, duplicateRecordDifferentCollection);

        duplicateWorkflowExecution = await waitForTestSfForRecord(duplicateRecordIdentifier, workflowArn, maxWaitForSFExistSecs);

        console.log(`Waiting for completed execution of ${duplicateWorkflowExecution.executionArn}`);
        duplicateExecutionStatus = await waitForCompletedExecution(duplicateWorkflowExecution.executionArn, maxWaitForExecutionSecs);
      });

      // Get the uniquified granuleId
      const uniqueTaskOutput = await lambdaStep.getStepOutput(duplicateWorkflowExecution.executionArn, 'AddUniqueGranuleId');
      const granule2 = uniqueTaskOutput.payload.granules[0];
      uniqueGranuleIdDuplicate = granule2.granuleId;
    });

    it('Executes successfully', () => {
      expect(duplicateExecutionStatus).toEqual('SUCCEEDED');
    });

    it('Makes the new granule with matching producerGranuleId available', async () => {
      const granule1 = await getGranule({
        prefix: testConfig.stackName,
        granuleId: uniqueGranuleId1,
        status: 'completed',
        collectionId: constructCollectionId(initialRuleOverride.collection.name, initialRuleOverride.collection.version),
      });

      const granule2 = await getGranule({
        prefix: testConfig.stackName,
        granuleId: uniqueGranuleIdDuplicate,
        status: 'completed',
        collectionId: constructCollectionId(duplicateRuleOverride.collection.name, duplicateRuleOverride.collection.version),
      });

      expect(granule1.producerGranuleId).toEqual(granule2.producerGranuleId);
      expect(granule1.granuleId !== granule2.granuleId).toBeTrue();
    });
  });

  describe('Workflow fails because SyncGranule fails', () => {
    let badRecord;

    beforeAll(async () => {
      badRecord = cloneDeep(initialRecord);
      badRecord.identifier = randomString();
      // bad record has a file which doesn't exist
      badRecord.product.files[0].uri = `s3://${testConfig.bucket}/somepath/key-does-not-exist`;

      await tryCatchExit(cleanUp, async () => {
        console.log(`Dropping bad record onto ${streamName}, recordIdentifier: ${badRecord.identifier}.`);
        await putRecordOnStream(streamName, badRecord);

        console.log('Waiting for step function to start...');
        failingWorkflowExecution = await waitForTestSfForRecord(badRecord.identifier, workflowArn, maxWaitForSFExistSecs);

        console.log(`Waiting for completed execution of ${failingWorkflowExecution.executionArn}.`);
        initialExecutionStatus = await waitForCompletedExecution(failingWorkflowExecution.executionArn, maxWaitForExecutionSecs);
      });
    });

    it('executes but fails', () => {
      expect(initialExecutionStatus).toEqual('FAILED');
    });

    it('outputs the error', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(failingWorkflowExecution.executionArn, 'SyncGranule', 'failure');
      expect(lambdaOutput.error).toEqual('FileNotFound');
      expect(lambdaOutput.cause).toMatch(/.+Source file not found.+/);
    });

    describe('the AddUniqueGranuleId Lambda', () => {
      let lambdaOutput;
      let granule;

      beforeAll(async () => {
        lambdaOutput = await lambdaStep.getStepOutput(failingWorkflowExecution.executionArn, 'AddUniqueGranuleId');
        granule = lambdaOutput.payload.granules[0];
        // granuleId is uniquified
        uniqueGranuleIdError = granule.granuleId;
        console.log(`AddUniqueGranuleId returns granuleId: ${uniqueGranuleIdError}, producerGranuleId: ${granule.producerGranuleId}`);
      });

      it('outputs the granules object', () => {
        expect(granule.producerGranuleId).toEqual(producerGranuleId);
        expect(uniqueGranuleIdError).not.toEqual(producerGranuleId);
        expect(uniqueGranuleIdError).toBeTruthy();
        expect(uniqueGranuleIdError).toMatch(
          new RegExp(`^${producerGranuleId}_[a-zA-Z0-9-]+$`)
        );
      });
    });

    describe('the CnmResponse Lambda', () => {
      let beforeAllFailed = false;
      let lambdaOutput;
      let failedGranule;

      beforeAll(async () => {
        try {
          lambdaOutput = await lambdaStep.getStepOutput(failingWorkflowExecution.executionArn, 'CnmResponse');
          failedGranule = await waitForApiRecord(
            getGranule,
            {
              prefix: testConfig.stackName,
              granuleId: uniqueGranuleIdError,
              collectionId: constructCollectionId(initialRuleOverride.collection.name, initialRuleOverride.collection.version),
            },
            {
              status: 'failed',
              execution: getExecutionUrlFromArn(failingWorkflowExecution.executionArn),
            }
          );
        } catch (error) {
          beforeAllFailed = true;
          console.log('CnmResponse Lambda error:::', error);
          throw error;
        }
      });

      it('prepares the test suite successfully', () => {
        if (beforeAllFailed) fail('beforeAll() failed to prepare test suite');
      });

      it('sends the error to the CnmResponse task', async () => {
        const CnmResponseInput = await lambdaStep.getStepInput(failingWorkflowExecution.executionArn, 'CnmResponse');
        expect(CnmResponseInput.exception.Error).toEqual('FileNotFound');
        expect(JSON.parse(CnmResponseInput.exception.Cause).errorMessage).toMatch(/Source file not found.+/);
      });

      it('writes a failure message to the response stream', async () => {
        console.log(`Fetching shard iterator for response stream  '${cnmResponseStreamName}'.`);
        responseStreamShardIterator = await getShardIterator(cnmResponseStreamName);
        const newResponseStreamRecords = await getRecords(responseStreamShardIterator);
        if (newResponseStreamRecords.length > 0) {
          const parsedRecords = newResponseStreamRecords.map((r) => JSON.parse(new TextDecoder().decode(r.Data)));
          const responseRecord = parsedRecords.pop();
          expect(responseRecord.response.status).toEqual('FAILURE');
          expect(responseRecord.identifier).toBe(badRecord.identifier);
        } else {
          fail(`unexpected error occurred and no messages found in ${cnmResponseStreamName}. Did the "ouputs the record" above fail?`);
        }
      });

      it('puts cnm message to cumulus message for granule record', () => {
        const cnm = get(lambdaOutput, 'meta.granule.queryFields.cnm');
        expect(isMatch(cnm, badRecord)).toBe(true);
        expect(get(failedGranule, 'queryFields.cnm')).toEqual(cnm);
      });
    });
  });
});
