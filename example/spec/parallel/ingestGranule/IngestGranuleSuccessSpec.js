'use strict';

const fs = require('fs-extra');
const got = require('got');
const path = require('path');
const { URL } = require('url');
const cloneDeep = require('lodash.clonedeep');
const difference = require('lodash.difference');
const includes = require('lodash.includes');
const intersection = require('lodash.intersection');

const {
  models: {
    AccessToken, Execution, Granule, Collection, Provider
  }
} = require('@cumulus/api');
const { serveDistributionApi } = require('@cumulus/api/bin/serve');
const {
  aws: {
    s3,
    deleteS3Object,
    s3GetObjectTagging,
    s3ObjectExists,
    parseS3Uri
  },
  BucketsConfig,
  constructCollectionId,
  file: { getFileChecksumFromStream }
} = require('@cumulus/common');
const { getUrl } = require('@cumulus/cmrjs');
const {
  api: apiTestUtils,
  executionsApi: executionsApiTestUtils,
  buildAndExecuteWorkflow,
  LambdaStep,
  conceptExists,
  getOnlineResources,
  granulesApi: granulesApiTestUtils,
  waitForConceptExistsOutcome,
  waitUntilGranuleStatusIs,
  waitForTestExecutionStart,
  waitForCompletedExecution,
  EarthdataLogin: { getEarthdataAccessToken },
  distributionApi: {
    getDistributionApiFileStream,
    getDistributionFileUrl
  }
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  deleteFolder,
  getExecutionUrl,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  getFilesMetadata,
  getPublicS3FileUrl
} = require('../../helpers/testUtils');
const {
  setDistributionApiEnvVars,
  stopDistributionApi
} = require('../../helpers/apiUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection
} = require('../../helpers/granuleUtils');

const { isReingestExecutionForGranuleId } = require('../../helpers/workflowUtils');

const { getConfigObject } = require('../../helpers/configUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();
const workflowName = 'IngestAndPublishGranule';

const workflowConfigFile = './workflows/sips.yml';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const templatedSyncGranuleFilename = templateFile({
  inputTemplateFilename: './spec/parallel/ingestGranule/SyncGranule.output.payload.template.json',
  config: config[workflowName].SyncGranuleOutput
});

const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: './spec/parallel/ingestGranule/IngestGranule.output.payload.template.json',
  config: config[workflowName].IngestGranuleOutput
});

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

function isExecutionForGranuleId(taskInput, params) {
  return taskInput.payload.granules && taskInput.payload.granules[0].granuleId === params.granuleId;
}

describe('The S3 Ingest Granules workflow', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleSuccess');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const newCollectionId = constructCollectionId(collection.name, collection.version);
  const provider = { id: `s3_provider${testSuffix}` };

  let workflowExecution = null;
  let failingWorkflowExecution;
  let failedExecutionArn;
  let failedExecutionName;
  let inputPayload;
  let expectedSyncGranulePayload;
  let expectedPayload;
  let expectedS3TagSet;
  let postToCmrOutput;
  let server;

  process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
  const accessTokensModel = new AccessToken();
  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const executionModel = new Execution();
  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();
  process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
  const providerModel = new Provider();
  let executionName;

  beforeAll(async (done) => {
    const collectionJson = JSON.parse(fs.readFileSync(`${collectionsDir}/s3_MOD09GQ_006.json`, 'utf8'));
    collectionJson.duplicateHandling = 'error';
    const collectionData = Object.assign({}, collectionJson, {
      name: collection.name,
      dataType: collectionJson.dataType + testSuffix
    });

    const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
    const providerData = Object.assign({}, providerJson, {
      id: provider.id,
      host: config.bucket
    });

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      apiTestUtils.addCollectionApi({ prefix: config.stackName, collection: collectionData }),
      apiTestUtils.addProviderApi({ prefix: config.stackName, provider: providerData })
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    const granuleId = inputPayload.granules[0].granuleId;
    expectedS3TagSet = [{ Key: 'granuleId', Value: granuleId }];
    await Promise.all(inputPayload.granules[0].files.map((fileToTag) =>
      s3().putObjectTagging({ Bucket: config.bucket, Key: `${fileToTag.path}/${fileToTag.name}`, Tagging: { TagSet: expectedS3TagSet } }).promise()));

    expectedSyncGranulePayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedSyncGranuleFilename, granuleId, testDataFolder, newCollectionId);
    expectedSyncGranulePayload.granules[0].dataType += testSuffix;
    expectedPayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedOutputPayloadFilename, granuleId, testDataFolder, newCollectionId);
    expectedPayload.granules[0].dataType += testSuffix;

    // process.env.DISTRIBUTION_ENDPOINT needs to be set for below
    setDistributionApiEnvVars();

    console.log('Start SuccessExecution');
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      inputPayload,
      {
        distribution_endpoint: process.env.DISTRIBUTION_ENDPOINT
      }
    );

    console.log('Start FailingExecution');
    failingWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      {}
    );
    failedExecutionArn = failingWorkflowExecution.executionArn.split(':');
    failedExecutionName = failedExecutionArn.pop();

    // Use done() to signal end of beforeAll() after distribution API has started up
    server = await serveDistributionApi(config.stackName, done);
  });

  afterAll(async (done) => {
    try {
      // clean up stack state added by test
      await Promise.all([
        deleteFolder(config.bucket, testDataFolder),
        collectionModel.delete(collection),
        providerModel.delete(provider),
        executionModel.delete({ arn: workflowExecution.executionArn }),
        executionModel.delete({ arn: failingWorkflowExecution.executionArn }),
        granulesApiTestUtils.deleteGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        })
      ]);
      stopDistributionApi(server, done);
    }
    catch (err) {
      stopDistributionApi(server, done);
    }
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  it('can retrieve the specific provider that was created', async () => {
    const providerListResponse = await apiTestUtils.getProviders({ prefix: config.stackName });
    const providerList = JSON.parse(providerListResponse.body);
    expect(providerList.results.length).toBeGreaterThan(0);

    const providerResultResponse = await apiTestUtils.getProvider({ prefix: config.stackName, providerId: provider.id });
    const providerResult = JSON.parse(providerResultResponse.body);
    expect(providerResult).not.toBeNull();
  });

  it('can retrieve the specific collection that was created', async () => {
    const collectionListResponse = await apiTestUtils.getCollections({ prefix: config.stackName });
    const collectionList = JSON.parse(collectionListResponse.body);
    expect(collectionList.results.length).toBeGreaterThan(0);

    const collectionResponse = await apiTestUtils.getCollection(
      { prefix: config.stackName, collectionName: collection.name, collectionVersion: collection.version }
    );
    const collectionResult = JSON.parse(collectionResponse.body);
    expect(collectionResult).not.toBeNull();
  });

  it('makes the granule available through the Cumulus API', async () => {
    const granuleResponse = await granulesApiTestUtils.getGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId
    });
    const granule = JSON.parse(granuleResponse.body);

    expect(granule.granuleId).toEqual(inputPayload.granules[0].granuleId);
  });

  describe('the SyncGranules task', () => {
    let lambdaInput;
    let lambdaOutput;

    beforeAll(async () => {
      lambdaInput = await lambdaStep.getStepInput(workflowExecution.executionArn, 'SyncGranule');
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
    });

    it('receives the correct collection and provider configuration', () => {
      expect(lambdaInput.meta.collection.name).toEqual(collection.name);
      expect(lambdaInput.meta.provider.id).toEqual(provider.id);
    });

    it('output includes the ingested granule with file staging location paths', () => {
      expect(lambdaOutput.payload).toEqual(expectedSyncGranulePayload);
    });

    it('updates the meta object with input_granules', () => {
      expect(lambdaOutput.meta.input_granules).toEqual(expectedSyncGranulePayload.granules);
    });
  });

  describe('the MoveGranules task', () => {
    let lambdaOutput;
    let files;
    let movedTaggings;
    let existCheck = [];

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      files = lambdaOutput.payload.granules[0].files;
      movedTaggings = await Promise.all(lambdaOutput.payload.granules[0].files.map((file) => {
        const { Bucket, Key } = parseS3Uri(file.filename);
        return s3GetObjectTagging(Bucket, Key);
      }));

      existCheck = await Promise.all([
        s3ObjectExists({ Bucket: files[0].bucket, Key: files[0].filepath }),
        s3ObjectExists({ Bucket: files[1].bucket, Key: files[1].filepath }),
        s3ObjectExists({ Bucket: files[2].bucket, Key: files[2].filepath })
      ]);
    });

    it('has a payload with correct buckets, filenames, filesizes', () => {
      files.forEach((file) => {
        const expectedFile = expectedPayload.granules[0].files.find((f) => f.name === file.name);
        expect(file.filename).toEqual(expectedFile.filename);
        expect(file.bucket).toEqual(expectedFile.bucket);
        if (file.fileSize) {
          expect(file.fileSize).toEqual(expectedFile.fileSize);
        }
      });
    });

    it('moves files to the bucket folder based on metadata', () => {
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
      });
    });

    it('preserves tags on moved files', () => {
      movedTaggings.forEach((tagging) => {
        expect(tagging.TagSet).toEqual(expectedS3TagSet);
      });
    });
  });

  describe('the PostToCmr task', () => {
    let bucketsConfig;
    let cmrResource;
    let files;
    let granule;
    let resourceURLs;
    let accessToken;

    beforeAll(async () => {
      bucketsConfig = new BucketsConfig(config.buckets);

      postToCmrOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
      if (postToCmrOutput === null) throw new Error(`Failed to get the PostToCmr step's output for ${workflowExecution.executionArn}`);

      granule = postToCmrOutput.payload.granules[0];
      files = granule.files;
      cmrResource = await getOnlineResources(granule);
      resourceURLs = cmrResource.map((resource) => resource.href);
    });

    afterAll(async () => {
      await accessTokensModel.delete({ accessToken });
    });

    it('has expected payload', () => {
      expect(granule.published).toBe(true);
      expect(granule.cmrLink).toEqual(`${getUrl('search')}granules.json?concept_id=${granule.cmrConceptId}`);

      // Set the expected CMR values since they're going to be different
      // every time this is run.
      const updatedExpectedPayload = cloneDeep(expectedPayload);
      updatedExpectedPayload.granules[0].cmrLink = granule.cmrLink;
      updatedExpectedPayload.granules[0].cmrConceptId = granule.cmrConceptId;

      expect(postToCmrOutput.payload).toEqual(updatedExpectedPayload);
    });

    it('publishes the granule metadata to CMR', () => {
      const result = conceptExists(granule.cmrLink);

      expect(granule.published).toEqual(true);
      expect(result).not.toEqual(false);
    });

    it('updates the CMR metadata online resources with the final metadata location', () => {
      const distributionUrl = getDistributionFileUrl({
        bucket: files[0].bucket,
        key: files[0].filepath
      });
      const s3Url = getPublicS3FileUrl({ bucket: files[2].bucket, key: files[2].filepath });

      expect(resourceURLs.includes(distributionUrl)).toBe(true);
      expect(resourceURLs.includes(s3Url)).toBe(true);
    });

    it('downloads the requested science file for authorized requests', async () => {
      // Login with Earthdata and get access token.
      const accessTokenResponse = await getEarthdataAccessToken({
        redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
        requestOrigin: process.env.DISTRIBUTION_ENDPOINT
      });
      accessToken = accessTokenResponse.accessToken;

      const scienceFileUrls = resourceURLs
        .filter((url) =>
          (url.startsWith(process.env.DISTRIBUTION_ENDPOINT) ||
          url.match(/s3\.amazonaws\.com/)) &&
          !url.endsWith('.cmr.xml') &&
          !url.contains('s3credentials'));

      const checkFiles = await Promise.all(
        scienceFileUrls
          .map(async (url) => {
            const extension = path.extname(new URL(url).pathname);
            const sourceFile = s3data.find((d) => d.endsWith(extension));
            const sourceChecksum = await getFileChecksumFromStream(
              fs.createReadStream(require.resolve(sourceFile))
            );
            const file = files.find((f) => f.name.endsWith(extension));

            let fileStream;

            if (bucketsConfig.type(file.bucket) === 'protected') {
              const fileUrl = getDistributionFileUrl({
                bucket: file.bucket,
                key: file.filepath
              });
              fileStream = getDistributionApiFileStream(fileUrl, accessToken);
            }
            else if (bucketsConfig.type(file.bucket) === 'public') {
              fileStream = got.stream(url);
            }

            // Compare checksum of downloaded file with expected checksum.
            const downloadChecksum = await getFileChecksumFromStream(fileStream);
            return downloadChecksum === sourceChecksum;
          })
      );

      checkFiles.forEach((fileCheck) => {
        expect(fileCheck).toBe(true);
      });
    });
  });

  describe('an SNS message', () => {
    let existCheck = [];

    beforeAll(async () => {
      executionName = postToCmrOutput.cumulus_meta.execution_name;
      existCheck = await Promise.all([
        s3ObjectExists({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${executionName}.output` }),
        s3ObjectExists({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${failedExecutionName}.output` })
      ]);
    });

    it('is published on a successful workflow completion', () => {
      expect(existCheck[0]).toEqual(true);
    });

    it('is published on workflow failure', () => {
      expect(existCheck[1]).toEqual(true);
    });

    it('triggers the granule record being added to DynamoDB', async () => {
      const record = await granuleModel.get({ granuleId: inputPayload.granules[0].granuleId });
      expect(record.execution).toEqual(getExecutionUrl(workflowExecution.executionArn));
    });

    it('triggers the execution record being added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: workflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });

  describe('The Cumulus API', () => {
    let workflowConfig;
    beforeAll(() => {
      workflowConfig = getConfigObject(workflowConfigFile, workflowName);
    });

    describe('granule endpoint', () => {
      let granule;
      let cmrLink;

      beforeAll(async () => {
        const granuleResponse = await granulesApiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        granule = JSON.parse(granuleResponse.body);
        cmrLink = granule.cmrLink;
      });

      it('makes the granule available through the Cumulus API', async () => {
        expect(granule.granuleId).toEqual(inputPayload.granules[0].granuleId);
      });

      it('has the granule with a CMR link', () => {
        expect(granule.cmrLink).not.toBeUndefined();
      });

      describe('when a reingest granule is triggered via the API', () => {
        let oldExecution;
        let oldUpdatedAt;
        let reingestResponse;
        let startTime;

        beforeAll(async () => {
          startTime = new Date();
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

        it('returns a warning that data may be overwritten when duplicateHandling is "error"', () => {
          expect(reingestResponse.warning && reingestResponse.warning.includes('overwritten')).toBeTruthy();
        });

        it('overwrites granule files', async () => {
          // Await reingest completion
          const reingestGranuleExecution = await waitForTestExecutionStart({
            workflowName,
            stackName: config.stackName,
            bucket: config.bucket,
            findExecutionFn: isReingestExecutionForGranuleId,
            findExecutionFnParams: { granuleId: inputPayload.granules[0].granuleId }
          });

          console.log(`Wait for completed execution ${reingestGranuleExecution.executionArn}`);

          await waitForCompletedExecution(reingestGranuleExecution.executionArn);

          const moveGranuleOutput = await lambdaStep.getStepOutput(
            reingestGranuleExecution.executionArn,
            'MoveGranule'
          );

          const moveGranuleOutputFiles = moveGranuleOutput.payload.granules[0].files;
          const nonCmrFiles = moveGranuleOutputFiles.filter((f) => !f.filename.endsWith('.cmr.xml'));
          nonCmrFiles.forEach((f) => expect(f.duplicate_found).toBe(true));

          await waitUntilGranuleStatusIs(config.stackName, inputPayload.granules[0].granuleId, 'completed');
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
            expect(cf.LastModified).toBeGreaterThan(startTime);
          });
        });
      });

      it('removeFromCMR removes the ingested granule from CMR', async () => {
        const existsInCMR = await conceptExists(cmrLink);

        expect(existsInCMR).toEqual(true);

        // Remove the granule from CMR
        await granulesApiTestUtils.removeFromCMR({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });

        // Check that the granule was removed
        await waitForConceptExistsOutcome(cmrLink, false);
        const doesExist = await conceptExists(cmrLink);
        expect(doesExist).toEqual(false);
      });

      it('applyWorkflow PublishGranule publishes the granule to CMR', async () => {
        const existsInCMR = await conceptExists(cmrLink);
        expect(existsInCMR).toEqual(false);

        // Publish the granule to CMR
        await granulesApiTestUtils.applyWorkflow({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId,
          workflow: 'PublishGranule'
        });

        const publishGranuleExecution = await waitForTestExecutionStart({
          workflowName: 'PublishGranule',
          stackName: config.stackName,
          bucket: config.bucket,
          findExecutionFn: isExecutionForGranuleId,
          findExecutionFnParams: { granuleId: inputPayload.granules[0].granuleId }
        });

        console.log(`Wait for completed execution ${publishGranuleExecution.executionArn}`);

        await waitForCompletedExecution(publishGranuleExecution.executionArn);

        await waitForConceptExistsOutcome(cmrLink, true);
        const doesExist = await conceptExists(cmrLink);
        expect(doesExist).toEqual(true);
      });

      describe('when moving a granule', () => {
        let file;
        let destinationKey;
        let destinations;

        beforeAll(() => {
          file = granule.files[0];

          destinationKey = `${testDataFolder}/${file.filepath}`;

          destinations = [{
            regex: '.*.hdf$',
            bucket: config.bucket,
            filepath: `${testDataFolder}/${path.dirname(file.filepath)}`
          }];
        });

        it('rejects moving a granule to a location that already exists', async () => {
          await s3().copyObject({
            Bucket: config.bucket,
            CopySource: `${file.bucket}/${file.filepath}`,
            Key: destinationKey
          }).promise();

          const moveGranuleResponse = await granulesApiTestUtils.moveGranule({
            prefix: config.stackName,
            granuleId: inputPayload.granules[0].granuleId,
            destinations
          });

          const responseBody = JSON.parse(moveGranuleResponse.body);

          expect(moveGranuleResponse.statusCode).toEqual(409);
          expect(responseBody.message).toEqual(
            `Cannot move granule because the following files would be overwritten at the destination location: ${granule.files[0].name}. Delete the existing files or reingest the source files.`
          );
        });

        it('when the file is deleted and the move retried, the move completes successfully', async () => {
          await deleteS3Object(config.bucket, destinationKey);

          // Sanity check
          let fileExists = await s3ObjectExists({ Bucket: config.bucket, Key: destinationKey });
          expect(fileExists).toBe(false);

          const moveGranuleResponse = await granulesApiTestUtils.moveGranule({
            prefix: config.stackName,
            granuleId: inputPayload.granules[0].granuleId,
            destinations
          });

          expect(moveGranuleResponse.statusCode).toEqual(200);

          fileExists = await s3ObjectExists({ Bucket: config.bucket, Key: destinationKey });
          expect(fileExists).toBe(true);
        });
      });

      it('can delete the ingested granule from the API', async () => {
        // pre-delete: Remove the granule from CMR
        await granulesApiTestUtils.removeFromCMR({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });

        // Delete the granule
        await granulesApiTestUtils.deleteGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });

        // Verify deletion
        const granuleResponse = await granulesApiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        const resp = JSON.parse(granuleResponse.body);
        expect(resp.message).toEqual('Granule not found');
      });
    });

    describe('executions endpoint', () => {
      let executionResponse;
      let executions;

      beforeAll(async () => {
        const executionsApiResponse = await executionsApiTestUtils.getExecutions({
          prefix: config.stackName
        });
        executions = JSON.parse(executionsApiResponse.body);
        const executionApiResponse = await executionsApiTestUtils.getExecution({
          prefix: config.stackName,
          arn: workflowExecution.executionArn
        });
        executionResponse = JSON.parse(executionApiResponse.body);
      });

      it('returns a list of exeuctions', async () => {
        expect(executions.results.length).toBeGreaterThan(0);
      });

      it('returns overall status and timing for the execution', async () => {
        expect(executionResponse.status).toBeDefined();
        expect(executionResponse.createdAt).toBeDefined();
        expect(executionResponse.updatedAt).toBeDefined();
        expect(executionResponse.duration).toBeDefined();
      });

      it('returns tasks metadata with name and version', async () => {
        expect(executionResponse.tasks).toBeDefined();
        expect(executionResponse.tasks.length).not.toEqual(0);
        Object.keys(executionResponse.tasks).forEach((step) => {
          const task = executionResponse.tasks[step];
          expect(task.name).toBeDefined();
          expect(task.version).toBeDefined();
        });
      });
    });

    describe('When accessing a workflow execution via the API', () => {
      let executionStatus;
      let allStates;

      beforeAll(async () => {
        const executionArn = workflowExecution.executionArn;
        const executionStatusResponse = await executionsApiTestUtils.getExecutionStatus({
          prefix: config.stackName,
          arn: executionArn
        });
        executionStatus = JSON.parse(executionStatusResponse.body);

        allStates = Object.keys(workflowConfig.States);
      });

      it('returns the inputs and outputs for the entire workflow', async () => {
        expect(executionStatus.execution).toBeTruthy();
        expect(executionStatus.execution.executionArn).toEqual(workflowExecution.executionArn);
        const input = JSON.parse(executionStatus.execution.input);
        const output = JSON.parse(executionStatus.execution.output);
        expect(input.payload).toEqual(inputPayload);
        expect(output.payload || output.replace).toBeTruthy();
      });

      it('returns the stateMachine information and workflow definition', async () => {
        expect(executionStatus.stateMachine).toBeTruthy();
        expect(executionStatus.stateMachine.stateMachineArn).toEqual(executionStatus.execution.stateMachineArn);
        expect(executionStatus.stateMachine.stateMachineArn.endsWith(executionStatus.stateMachine.name)).toBe(true);

        const definition = JSON.parse(executionStatus.stateMachine.definition);
        expect(definition.Comment).toEqual('Ingest Granule');
        const stateNames = Object.keys(definition.States);

        // definition has all the states' information
        expect(difference(allStates, stateNames).length).toBe(0);
      });

      it('returns the inputs, outputs, timing, and status information for each executed step', async () => {
        expect(executionStatus.executionHistory).toBeTruthy();

        // expected 'not executed' steps
        const expectedNotExecutedSteps = ['SyncGranule', 'WorkflowFailed'];

        // expected 'executed' steps
        const expectedExecutedSteps = difference(allStates, expectedNotExecutedSteps);

        // steps with *EventDetails will have the input/output, and also stepname when state is entered/exited
        const stepNames = [];
        executionStatus.executionHistory.events.forEach((event) => {
          // expect timing information for each step
          expect(event.timestamp).toBeDefined();
          const eventKeys = Object.keys(event);
          // protect against "undefined": TaskStateEntered has "input" but not "name"
          if (event.name && intersection(eventKeys, ['input', 'output']).length === 1) {
            // each step should contain status information
            if (event.type === 'TaskStateExited') {
              const prevEvent = executionStatus.executionHistory.events[event.previousEventId - 1];
              expect(['LambdaFunctionSucceeded', 'LambdaFunctionFailed']).toContain(prevEvent.type);
            }
            if (!includes(stepNames, event.name)) stepNames.push(event.name);
          }
        });

        // all the executed steps have *EventDetails
        expect(difference(expectedExecutedSteps, stepNames).length).toBe(0);
        // some steps are not executed
        expect(difference(expectedNotExecutedSteps, stepNames).length).toBe(expectedNotExecutedSteps.length);
      });
    });

    describe('logs endpoint', () => {
      it('returns logs with a specific execution name', async () => {
        const executionARNTokens = workflowExecution.executionArn.split(':');
        const logsExecutionName = executionARNTokens[executionARNTokens.length - 1];
        const logsResponse = await apiTestUtils.getExecutionLogs({ prefix: config.stackName, executionName: logsExecutionName });
        const logs = JSON.parse(logsResponse.body);
        expect(logs.meta.count).not.toEqual(0);
        logs.results.forEach((log) => {
          expect(log.sender).not.toBe(undefined);
          expect(log.executions).toEqual(logsExecutionName);
        });
      });
    });

    describe('workflows endpoint', () => {
      it('returns a list of workflows', async () => {
        const workflowsResponse = await apiTestUtils.getWorkflows({ prefix: config.stackName });

        const workflows = JSON.parse(workflowsResponse.body);
        expect(workflows).not.toBe(undefined);
        expect(workflows.length).toBeGreaterThan(0);
      });

      it('returns the expected workflow', async () => {
        const workflowResponse = await apiTestUtils.getWorkflow({
          prefix: config.stackName,
          workflowName: workflowName
        });
        const foundWorkflow = JSON.parse(workflowResponse.body);
        const foundKeys = Object.keys(foundWorkflow.definition.States);
        const configKeys = Object.keys(workflowConfig.States);
        expect(foundWorkflow.definition.Comment).toEqual(workflowConfig.Comment);
        expect(foundKeys).toEqual(configKeys);
      });
    });
  });
});
