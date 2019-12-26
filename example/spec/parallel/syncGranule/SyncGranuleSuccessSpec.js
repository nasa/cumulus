const fs = require('fs');
const difference = require('lodash.difference');
const path = require('path');
const {
  buildAndExecuteWorkflow,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  granulesApi: granulesApiTestUtils,
  waitForTestExecutionStart,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');
const { Collection, Execution, Granule } = require('@cumulus/api/models');
const {
  aws: {
    s3,
    s3GetObjectTagging,
    s3ObjectExists,
    parseS3Uri
  },
  constructCollectionId
} = require('@cumulus/common');
const { LambdaStep } = require('@cumulus/common/sfnStep');
const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
  getFilesMetadata
} = require('../../helpers/testUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection
} = require('../../helpers/granuleUtils');
const { isReingestExecutionForGranuleId } = require('../../helpers/workflowUtils');
const { waitForModelStatus } = require('../../helpers/apiUtils');

const workflowName = 'SyncGranule';
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

describe('The Sync Granules workflow', () => {
  let collection;
  let config;
  let executionModel;
  let expectedPayload;
  let expectedS3TagSet;
  let granuleModel;
  let inputPayload;
  let lambdaStep;
  let provider;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;

  beforeAll(async () => {
    config = await loadConfig();
    lambdaStep = new LambdaStep();

    process.env.GranulesTable = `${config.stackName}-GranulesTable`;
    granuleModel = new Granule();

    const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

    const s3data = [
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf'
    ];

    const testId = createTimestampedTestId(config.stackName, 'SyncGranuleSuccess');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranule.input.payload.json';


    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    provider = { id: `s3_provider${testSuffix}` };
    const newCollectionId = constructCollectionId(collection.name, collection.version);

    process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
    executionModel = new Execution();
    process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
    const collectionModel = new Collection();

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);
    await collectionModel.update(collection, { duplicateHandling: 'replace' });

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    inputPayload.granules[0].files[0] = Object.assign(inputPayload.granules[0].files[0], { checksum: '8d1ec5c0463e59d26adee87cdbbee816', checksumType: 'md5' });
    const newGranuleId = inputPayload.granules[0].granuleId;
    expectedS3TagSet = [{ Key: 'granuleId', Value: newGranuleId }];
    await Promise.all(inputPayload.granules[0].files.map((fileToTag) =>
      s3().putObjectTagging({ Bucket: config.bucket, Key: `${fileToTag.path}/${fileToTag.name}`, Tagging: { TagSet: expectedS3TagSet } }).promise()));

    const templatedOutputPayloadFilename = templateFile({
      inputTemplateFilename: './spec/parallel/syncGranule/SyncGranule.output.payload.template.json',
      config: {
        granules: [
          {
            files: [
              {
                bucket: config.buckets.internal.name,
                filename: `s3://${config.buckets.internal.name}/custom-staging-dir/${config.stackName}/replace-me-collectionId/replace-me-granuleId.hdf`,
                fileStagingDir: `custom-staging-dir/${config.stackName}/replace-me-collectionId`
              },
              {
                bucket: config.buckets.internal.name,
                filename: `s3://${config.buckets.internal.name}/custom-staging-dir/${config.stackName}/replace-me-collectionId/replace-me-granuleId.hdf.met`,
                fileStagingDir: `custom-staging-dir/${config.stackName}/replace-me-collectionId`
              }
            ]
          }
        ]
      }
    });

    expectedPayload = loadFileWithUpdatedGranuleIdPathAndCollection(
      templatedOutputPayloadFilename,
      newGranuleId,
      testDataFolder,
      newCollectionId,
      config.stackName
    );

    expectedPayload.granules[0].dataType += testSuffix;
    expectedPayload.granules[0].files[0] = Object.assign(expectedPayload.granules[0].files[0], { checksum: '8d1ec5c0463e59d26adee87cdbbee816', checksumType: 'md5' });


    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      granulesApiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
  });

  it('has a checksum to test', () => {
    expect(inputPayload.granules[0].files[0].checksum).toBeDefined();
    expect(inputPayload.granules[0].files[0].checksumType).toBeDefined();
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the SyncGranule Lambda function', () => {
    let lambdaOutput = null;
    let files;
    let key1;
    let key2;
    let syncedTaggings;
    let existCheck = [];

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
      files = lambdaOutput.payload.granules[0].files;
      key1 = path.join(files[0].fileStagingDir, files[0].name);
      key2 = path.join(files[1].fileStagingDir, files[1].name);

      existCheck = await Promise.all([
        s3ObjectExists({ Bucket: files[0].bucket, Key: key1 }),
        s3ObjectExists({ Bucket: files[1].bucket, Key: key2 })
      ]);
      syncedTaggings = await Promise.all(files.map((file) => {
        const { Bucket, Key } = parseS3Uri(file.filename);
        return s3GetObjectTagging(Bucket, Key);
      }));
    });

    it('receives payload with file objects updated to include file staging location', () => {
      const thisExpectedPayload = {
        ...expectedPayload,
        granules: [
          {
            ...expectedPayload.granules[0],
            sync_granule_duration: lambdaOutput.payload.granules[0].sync_granule_duration
          }
        ]
      };

      expect(lambdaOutput.payload).toEqual(thisExpectedPayload);
    });

    it('receives meta.input_granules with files objects updated to include file staging location', () => {
      const thisExpectedGranules = [
        {
          ...expectedPayload.granules[0],
          sync_granule_duration: lambdaOutput.payload.granules[0].sync_granule_duration
        }
      ];

      expect(lambdaOutput.meta.input_granules).toEqual(thisExpectedGranules);
    });

    it('receives files with custom staging directory', () => {
      files.forEach((file) => {
        expect(file.fileStagingDir).toMatch('custom-staging-dir\/.*');
      });
    });

    it('adds files to staging location', () => {
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
      });
    });

    it('preserves S3 tags on provider files', () => {
      syncedTaggings.forEach((tagging) => {
        expect(tagging.TagSet).toEqual(expectedS3TagSet);
      });
    });

    it('maintains tested checksums', () => {
      expect(lambdaOutput.payload.granules[0].files[0].checksum).toBeDefined();
      expect(lambdaOutput.payload.granules[0].files[0].checksumType).toBeDefined();
    });
  });

  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await waitForModelStatus(
        executionModel,
        { arn: workflowExecution.executionArn },
        'completed'
      );
      expect(record.status).toEqual('completed');
    });
  });

  describe('when a reingest granule is triggered via the API', () => {
    let oldExecution;
    let oldUpdatedAt;
    let reingestResponse;
    let granule;

    beforeAll(async () => {
      const granuleResponse = await granulesApiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      granule = JSON.parse(granuleResponse.body);

      oldUpdatedAt = granule.updatedAt;
      oldExecution = granule.execution;
      const reingestGranuleResponse = await granulesApiTestUtils.reingestGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      reingestResponse = JSON.parse(reingestGranuleResponse.body);
    });

    it('executes successfully', () => {
      expect(reingestResponse.status).toEqual('SUCCESS');
    });

    it('does not return a warning that data may be overwritten when duplicateHandling is "replace"', () => {
      expect(reingestResponse.warning).toBeFalsy();
    });

    it('overwrites granule files', async () => {
      // Await reingest completion
      const reingestGranuleExecution = await waitForTestExecutionStart({
        workflowName,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: isReingestExecutionForGranuleId,
        findExecutionFnParams: { granuleId: inputPayload.granules[0].granuleId },
        startTask: 'SyncGranule'
      });

      console.log(`Wait for completed execution ${reingestGranuleExecution.executionArn}`);

      await waitForCompletedExecution(reingestGranuleExecution.executionArn);

      const syncGranuleTaskOutput = await lambdaStep.getStepOutput(
        reingestGranuleExecution.executionArn,
        'SyncGranule'
      );

      syncGranuleTaskOutput.payload.granules[0].files.forEach((f) => {
        expect(f.duplicate_found).toBe(true);
      });

      await waitForModelStatus(
        granuleModel,
        { granuleId: inputPayload.granules[0].granuleId },
        'completed'
      );

      const updatedGranuleResponse = await granulesApiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });

      const updatedGranule = JSON.parse(updatedGranuleResponse.body);
      expect(updatedGranule.status).toEqual('completed');
      expect(updatedGranule.updatedAt).toBeGreaterThan(oldUpdatedAt);
      expect(updatedGranule.execution).not.toEqual(oldExecution);

      // the updated granule has the same files
      const oldFileNames = granule.files.map((f) => f.filename);
      const newFileNames = updatedGranule.files.map((f) => f.filename);
      expect(difference(oldFileNames, newFileNames).length).toBe(0);

      const currentFiles = await getFilesMetadata(updatedGranule.files);
      currentFiles.forEach((cf) => {
        expect(cf.LastModified).toBeGreaterThan(reingestGranuleExecution.startDate);
      });
    });
  });

  describe('when a bad checksum is provided', () => {
    let lambdaOutput = null;
    let failingExecution = null;

    beforeAll(async () => {
      inputPayload.granules[0].files[0].checksum = 'badCheckSum01';
      failingExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
      lambdaOutput = await lambdaStep.getStepOutput(failingExecution.executionArn, 'SyncGranule', 'failure');
    });

    it('completes execution with failure status', () => {
      expect(failingExecution.status).toEqual('FAILED');
    });

    it('raises an error', () => {
      expect(lambdaOutput.error).toEqual('InvalidChecksum');
    });
  });
});
