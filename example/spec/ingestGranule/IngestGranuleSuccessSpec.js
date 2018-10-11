'use strict';

const fs = require('fs-extra');
const urljoin = require('url-join');
const got = require('got');
const cloneDeep = require('lodash.clonedeep');
const {
  models: { Execution, Granule }
} = require('@cumulus/api');
const {
  aws: { s3, s3ObjectExists },
  constructCollectionId
} = require('@cumulus/common');
const {
  api: apiTestUtils,
  buildAndExecuteWorkflow,
  LambdaStep,
  conceptExists,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  getOnlineResources,
  waitForConceptExistsOutcome,
  waitUntilGranuleStatusIs
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  deleteFolder,
  getExecutionUrl,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../helpers/testUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection
} = require('../helpers/granuleUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const workflowName = 'IngestAndPublishGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const templatedSyncGranuleFilename = templateFile({
  inputTemplateFilename: './spec/ingestGranule/SyncGranule.output.payload.template.json',
  config: config[workflowName].SyncGranuleOutput
});

const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: './spec/ingestGranule/IngestGranule.output.payload.template.json',
  config: config[workflowName].IngestGranuleOutput
});

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

const isLambdaStatusLogEntry = (logEntry) =>
  logEntry.message.includes('START')
  || logEntry.message.includes('END')
  || logEntry.message.includes('REPORT');

const isCumulusLogEntry = (logEntry) => !isLambdaStatusLogEntry(logEntry);

describe('The S3 Ingest Granules workflow', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleSuccess');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const newCollectionId = constructCollectionId(collection.name, collection.version);
  const provider = { id: `s3_provider${testSuffix}` };
  let workflowExecution = null;
  let failingWorkflowExecution = null;
  let failedExecutionArn;
  let failedExecutionName;
  let inputPayload;
  let expectedSyncGranulePayload;
  let expectedPayload;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const executionModel = new Execution();
  let executionName;

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);

    console.log('Starting ingest test');
    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    const granuleId = inputPayload.granules[0].granuleId;

    expectedSyncGranulePayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedSyncGranuleFilename, granuleId, testDataFolder, newCollectionId);
    expectedSyncGranulePayload.granules[0].dataType += testSuffix;
    expectedPayload = loadFileWithUpdatedGranuleIdPathAndCollection(templatedOutputPayloadFilename, granuleId, testDataFolder, newCollectionId);
    expectedPayload.granules[0].dataType += testSuffix;

    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      inputPayload
    );

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
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      s3().deleteObject({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${executionName}.output` }).promise(),
      s3().deleteObject({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${failedExecutionName}.output` }).promise(),
      apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  it('makes the granule available through the Cumulus API', async () => {
    const granule = await apiTestUtils.getGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId
    });

    expect(granule.granuleId).toEqual(inputPayload.granules[0].granuleId);
  });

  describe('the SyncGranules task', () => {
    let lambdaOutput;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
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
    const existCheck = [];

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
      files = lambdaOutput.payload.granules[0].files;
      existCheck[0] = await s3ObjectExists({ Bucket: files[0].bucket, Key: files[0].filepath });
      existCheck[1] = await s3ObjectExists({ Bucket: files[1].bucket, Key: files[1].filepath });
      existCheck[2] = await s3ObjectExists({ Bucket: files[2].bucket, Key: files[2].filepath });
    });

    afterAll(async () => {
      await s3().deleteObject({ Bucket: files[0].bucket, Key: files[0].filepath }).promise();
      await s3().deleteObject({ Bucket: files[1].bucket, Key: files[1].filepath }).promise();
      await s3().deleteObject({ Bucket: files[3].bucket, Key: files[3].filepath }).promise();
    });

    it('has a payload with correct buckets and filenames', () => {
      files.forEach((file) => {
        const expectedFile = expectedPayload.granules[0].files.find((f) => f.name === file.name);
        expect(file.filename).toEqual(expectedFile.filename);
        expect(file.bucket).toEqual(expectedFile.bucket);
      });
    });

    it('moves files to the bucket folder based on metadata', () => {
      existCheck.forEach((check) => {
        expect(check).toEqual(true);
      });
    });
  });

  describe('the PostToCmr task', () => {
    let lambdaOutput;
    let cmrResource;
    let cmrLink;
    let response;
    let files;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
      if (lambdaOutput === null) throw new Error(`Failed to get the PostToCmr step's output for ${workflowExecution.executionArn}`);

      files = lambdaOutput.payload.granules[0].files;
      cmrLink = lambdaOutput.payload.granules[0].cmrLink;
      cmrResource = await getOnlineResources(cmrLink);
      response = await got(cmrResource[1].href);
    });

    afterAll(async () => {
      await s3().deleteObject({ Bucket: files[2].bucket, Key: files[2].filepath }).promise();
    });

    it('has expected payload', () => {
      const granule = lambdaOutput.payload.granules[0];
      expect(granule.published).toBe(true);
      expect(granule.cmrLink.startsWith('https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=')).toBe(true);

      // Set the expected cmrLink to the actual cmrLink, since it's going to
      // be different every time this is run.
      const updatedExpectedpayload = cloneDeep(expectedPayload);
      updatedExpectedpayload.granules[0].cmrLink = lambdaOutput.payload.granules[0].cmrLink;

      expect(lambdaOutput.payload).toEqual(updatedExpectedpayload);
    });

    it('publishes the granule metadata to CMR', () => {
      const granule = lambdaOutput.payload.granules[0];
      const result = conceptExists(granule.cmrLink);

      expect(granule.published).toEqual(true);
      expect(result).not.toEqual(false);
    });

    it('updates the CMR metadata online resources with the final metadata location', () => {
      const distEndpoint = config.DISTRIBUTION_ENDPOINT;
      const extension1 = urljoin(files[0].bucket, files[0].filepath);
      const filename = `https://${files[2].bucket}.s3.amazonaws.com/${files[2].filepath}`;

      expect(cmrResource[0].href).toEqual(urljoin(distEndpoint, extension1));
      expect(cmrResource[1].href).toEqual(filename);

      expect(response.statusCode).toEqual(200);
    });
  });

  describe('an SNS message', () => {
    let lambdaOutput;
    const existCheck = [];

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
      executionName = lambdaOutput.cumulus_meta.execution_name;
      existCheck[0] = await s3ObjectExists({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${executionName}.output` });
      existCheck[1] = await s3ObjectExists({ Bucket: config.bucket, Key: `${config.stackName}/test-output/${failedExecutionName}.output` });
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
    describe('granule endpoint', () => {
      let granule;
      let cmrLink;

      beforeAll(async () => {
        granule = await apiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        cmrLink = granule.cmrLink;
      });

      it('makes the granule available through the Cumulus API', async () => {
        expect(granule.granuleId).toEqual(inputPayload.granules[0].granuleId);
      });

      it('has the granule with a CMR link', () => {
        expect(granule.cmrLink).not.toBeUndefined();
      });

      it('allows reingest and executes with success status', async () => {
        granule = await apiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        const oldUpdatedAt = granule.updatedAt;
        const oldExecution = granule.execution;

        // Reingest Granule and compare the updatedAt times
        const response = await apiTestUtils.reingestGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        expect(response.status).toEqual('SUCCESS');

        const newUpdatedAt = (await apiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        })).updatedAt;
        expect(newUpdatedAt).not.toEqual(oldUpdatedAt);

        // Await reingest completion
        await waitUntilGranuleStatusIs(config.stackName, inputPayload.granules[0].granuleId, 'completed');
        const updatedGranule = await apiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        expect(updatedGranule.status).toEqual('completed');
        expect(updatedGranule.execution).not.toEqual(oldExecution);
      });

      it('removeFromCMR removes the ingested granule from CMR', async () => {
        const existsInCMR = await conceptExists(cmrLink);

        expect(existsInCMR).toEqual(true);

        // Remove the granule from CMR
        await apiTestUtils.removeFromCMR({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });

        // Check that the granule was removed
        await waitForConceptExistsOutcome(cmrLink, false, 10, 4000);
        const doesExist = await conceptExists(cmrLink);
        expect(doesExist).toEqual(false);
      });

      it('applyWorkflow PublishGranule publishes the granule to CMR', async () => {
        const existsInCMR = await conceptExists(cmrLink);
        expect(existsInCMR).toEqual(false);

        // Publish the granule to CMR
        await apiTestUtils.applyWorkflow({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId,
          workflow: 'PublishGranule'
        });

        await waitForConceptExistsOutcome(cmrLink, true, 10, 30000);
        const doesExist = await conceptExists(cmrLink);
        expect(doesExist).toEqual(true);
      });

      it('can delete the ingested granule from the API', async () => {
        // pre-delete: Remove the granule from CMR
        await apiTestUtils.removeFromCMR({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });

        // Delete the granule
        await apiTestUtils.deleteGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });

        // Verify deletion
        const resp = await apiTestUtils.getGranule({
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId
        });
        expect(resp.message).toEqual('Granule not found');
      });
    });

    describe('executions endpoint', () => {
      it('returns tasks metadata with name and version', async () => {
        const executionResponse = await apiTestUtils.getExecution({
          prefix: config.stackName,
          arn: workflowExecution.executionArn
        });
        expect(executionResponse.tasks).toBeDefined();
        expect(executionResponse.tasks.length).not.toEqual(0);
        Object.keys(executionResponse.tasks).forEach((step) => {
          const task = executionResponse.tasks[step];
          expect(task.name).toBeDefined();
          expect(task.version).toBeDefined();
        });
      });
    });

    describe('logs endpoint', () => {
      it('returns the execution logs', async () => {
        const logs = await apiTestUtils.getLogs({ prefix: config.stackName });
        expect(logs).not.toBe(undefined);
        expect(logs.results.length).toEqual(10);
      });

      it('returns logs with sender set', async () => {
        const getLogsResponse = await apiTestUtils.getLogs({ prefix: config.stackName });

        const logEntries = getLogsResponse.results;
        const cumulusLogEntries = logEntries.filter(isCumulusLogEntry);

        cumulusLogEntries.forEach((logEntry) => {
          if (!logEntry.sender) {
            console.log('Expected a sender property:', JSON.stringify(logEntry, null, 2));
          }
          expect(logEntry.sender).not.toBe(undefined);
        });
      });

      it('returns logs with a specific execution name', async () => {
        const executionARNTokens = workflowExecution.executionArn.split(':');
        const executionName = executionARNTokens[executionARNTokens.length - 1];
        const logs = await apiTestUtils.getExecutionLogs({ prefix: config.stackName, executionName: executionName });
        expect(logs.meta.count).not.toEqual(0);
        logs.results.forEach((log) => {
          expect(log.sender).not.toBe(undefined);
          expect(log.executions).toEqual(executionName);
        });
      });
    });
  });
});
