const fs = require('fs');
const { s3, s3ObjectExists } = require('@cumulus/common/aws');
const { buildAndExecuteWorkflow, LambdaStep, conceptExists, getOnlineResources } =
  require('@cumulus/integration-tests');

const { loadConfig, templateFile } = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'IngestGranule';

const syncGranuleOutputFilename = './spec/ingestGranule/SyncGranule.output.payload.template.json';
const templatedSyncGranuleFilename = templateFile({
  inputTemplateFilename: syncGranuleOutputFilename,
  config: config[taskName].SyncGranuleOutput
});
const expectedSyncGranulePayload = JSON.parse(fs.readFileSync(templatedSyncGranuleFilename));

const outputPayloadTemplateFilename = './spec/ingestGranule/IngestGranule.output.payload.template.json'; // eslint-disable-line max-len
const expectedPayload = JSON.parse(fs.readFileSync(outputPayloadTemplateFilename));

describe('The S3 Ingest Granules workflow', () => {
  const inputPayloadFilename = './spec/ingestGranule/IngestGranule.input.payload.json';
  const inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename));
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  let workflowExecution = null;

  beforeAll(async () => {
    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );
  });

  it('completes execution with success status', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the SyncGranules task', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
    });

    it('has expected payload', () => {
      expect(lambdaOutput.payload).toEqual(expectedSyncGranulePayload);
    });

    it('has expected updated meta', () => {
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
      await s3().deleteObject({ Bucket: files[2].bucket, Key: files[2].filepath }).promise();
    });

    it('has a payload with updated filename', () => {
      let i;
      for (i = 0; i < 3; i += 1) {
        expect(files[i].filename).toEqual(expectedPayload.granules[0].files[i].filename);
      }
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

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
      cmrLink = lambdaOutput.payload.granules[0].cmrLink;
      cmrResource = await getOnlineResources(cmrLink);
    });

    it('has expected payload', () => {
      const granule = lambdaOutput.payload.granules[0];
      expect(granule.published).toBe(true);
      expect(granule.cmrLink.startsWith('https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=')).toBe(true);

      expect(lambdaOutput.payload).toEqual(expectedPayload);
    });

    it('publishes the granule metadata to CMR', () => {
      const granule = lambdaOutput.payload.granules[0];
      const result = conceptExists(granule.cmrLink);

      expect(granule.published).toEqual(true);
      expect(result).not.toEqual(false);
    });

    it('updates the CMR metadata online resources with the final metadata location', () => {
      const granule = lambdaOutput.payload.granules[0];

      expect(cmrResource[0].href).toEqual(granule.files[0].filename);
      expect(cmrResource[1].href).toEqual(granule.files[1].filename);
    });
  });
});
