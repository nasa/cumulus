'use strict';

const fs = require('fs-extra');

const { models: { Granule } } = require('@cumulus/api');
const {
  buildAndExecuteWorkflow,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  api: apiTestUtils
} = require('@cumulus/integration-tests');
const { loadConfig, timestampedTestPrefix } = require('../helpers/testUtils');
const config = loadConfig();
const workflowName = 'IngestGranule';

describe('The FTP Ingest Granules workflow', () => {
  const testPostfix = timestampedTestPrefix(`_${config.stackName}-IngestGranuleFtpSuccess`);
  const inputPayloadFilename = './spec/ingestGranule/IngestGranuleFtp.input.payload.json';
  const providersDir = './data/providers/ftp/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testPostfix}`, version: '006' };
  const provider = { id: `ftp_provider${testPostfix}` };
  let workflowExecution = null;
  let inputPayload;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      await addCollections(config.stackName, config.bucket, collectionsDir, testPostfix),
      await addProviders(config.stackName, config.bucket, providersDir, null, testPostfix)
    ]);

    console.log('\nStarting ingest test');
    inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename, 'utf8'));
    inputPayload.granules[0].dataType += testPostfix;
    // delete the granule record from DynamoDB if exists
    await granuleModel.delete({ granuleId: inputPayload.granules[0].granuleId });

    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      await cleanupCollections(config.stackName, config.bucket, collectionsDir, testPostfix),
      await cleanupProviders(config.stackName, config.bucket, providersDir, testPostfix)
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
    // clean up granule
    await apiTestUtils.deleteGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId
    });
  });
});
