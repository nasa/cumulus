'use strict';

const fs = require('fs-extra');

const { models: { Granule } } = require('@cumulus/api');
const { aws: { headObject } } = require('@cumulus/common');
const { randomStringFromRegex } = require('@cumulus/common/test-utils');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  granulesApi: granulesApiTestUtils
} = require('@cumulus/integration-tests');
const mime = require('mime-types');
const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const { waitForModelStatus } = require('../../helpers/apiUtils');
const workflowName = 'IngestGranule';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

describe('The FTP Ingest Granules workflow', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranuleFtp.input.payload.json';
  const providersDir = './data/providers/ftp/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  let config;
  let granuleModel;
  let inputPayload;
  let testSuffix;
  let workflowExecution;

  beforeAll(async () => {
    config = await loadConfig();

    const testId = createTimestampedTestId(config.stackName, 'IngestGranuleFtpSuccess');
    testSuffix = createTestSuffix(testId);
    const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    const provider = { id: `ftp_provider${testSuffix}` };

    process.env.GranulesTable = `${config.stackName}-GranulesTable`;
    granuleModel = new Granule();

    // populate collections, providers and test data
    await Promise.all([
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
      addProviders(config.stackName, config.bucket, providersDir, null, testSuffix)
    ]);

    console.log('\nStarting ingest test');
    inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename, 'utf8'));
    inputPayload.granules[0].dataType += testSuffix;
    inputPayload.granules[0].granuleId = randomStringFromRegex(granuleRegex);

    console.log(`Granule id is ${inputPayload.granules[0].granuleId}`);

    // delete the granule record from DynamoDB if exists
    await granuleModel.delete({ granuleId: inputPayload.granules[0].granuleId });

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix)
    ]);
  });

  describe('the execution', () => {
    let granule;
    let granuleResponse;

    beforeAll(async () => {
      // Check that the granule has been updated in dynamo
      // before performing further checks
      await waitForModelStatus(
        granuleModel,
        { granuleId: inputPayload.granules[0].granuleId },
        'completed'
      );

      granuleResponse = await granulesApiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
      granule = JSON.parse(granuleResponse.body);
    });

    afterAll(async () => {
      // clean up granule
      await granulesApiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      });
    });

    it('completes execution with success status', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });

    it('makes the granule available through the Cumulus API', async () => {
      expect(granule.granuleId).toEqual(inputPayload.granules[0].granuleId);
    });

    it('uploaded the granules with correct ContentType', async () => {
      console.log(`File object on intermittently failing test: ${JSON.stringify(granule.files)}`);
      console.log(`Granule object on intermittently failing test: ${JSON.stringify(granule)}`);
      const headObjects = await Promise.all(granule.files.map(async (fileObject) =>
        Object.assign({},
          fileObject,
          await headObject(fileObject.bucket, fileObject.key),
          { expectedMime: mime.lookup(fileObject.key) || 'application/octet-stream' })));
      headObjects.forEach((headObj) => expect(headObj.expectedMime).toEqual(headObj.ContentType));
    });
  });
});
