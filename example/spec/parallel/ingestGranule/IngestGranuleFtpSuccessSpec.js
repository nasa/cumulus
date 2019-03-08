'use strict';

const fs = require('fs-extra');

const { models: { Granule } } = require('@cumulus/api');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  granulesApi: granulesApiTestUtils
} = require('@cumulus/integration-tests');
const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const config = loadConfig();
const workflowName = 'IngestGranule';

describe('The FTP Ingest Granules workflow', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleFtpSuccess');
  const testSuffix = createTestSuffix(testId);
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranuleFtp.input.payload.json';
  const providersDir = './data/providers/ftp/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `ftp_provider${testSuffix}` };
  let workflowExecution = null;
  let inputPayload;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, null, testSuffix)
    ]);

    console.log('\nStarting ingest test');
    inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename, 'utf8'));
    inputPayload.granules[0].dataType += testSuffix;
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

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  it('makes the granule available through the Cumulus API', async () => {
    const granuleResponse = await granulesApiTestUtils.getGranule({
      prefix: config.prefix,
      granuleId: inputPayload.granules[0].granuleId
    });
    const granule = JSON.parse(granuleResponse.body);

    expect(granule.granuleId).toEqual(inputPayload.granules[0].granuleId);
    // clean up granule
    await granulesApiTestUtils.deleteGranule({
      prefix: config.prefix,
      granuleId: inputPayload.granules[0].granuleId
    });
  });
});
