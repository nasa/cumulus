'use strict';

const fs = require('fs-extra');

const { models: { Granule } } = require('@cumulus/api');
const { buildAndExecuteWorkflow } = require('@cumulus/integration-tests');
const { api: apiTestUtils } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');
const config = loadConfig();
const workflowName = 'IngestGranule';

describe('The FTP Ingest Granules workflow', () => {
  const inputPayloadFilename = './spec/ingestGranule/IngestGranuleFtp.input.payload.json';
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 'ftp_provider' };
  let workflowExecution = null;
  let inputPayload;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();

  beforeAll(async () => {
    console.log('\nStarting ingest test');
    inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename, 'utf8'));
    // delete the granule record from DynamoDB if exists
    await granuleModel.delete({ granuleId: inputPayload.granules[0].granuleId });

    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
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
});
