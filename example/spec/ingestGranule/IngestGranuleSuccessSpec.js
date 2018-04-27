const fs = require('fs');
const { s3ObjectExists } = require('@cumulus/common/aws');
const { buildAndExecuteWorkflow, LambdaStep, conceptExists } =
  require('@cumulus/integration-tests');

const { loadConfig, templateFile } = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'IngestGranule';

const outputPayloadTemplateFilename = './spec/ingestGranule/IngestGranule.output.payload.template.json'; // eslint-disable-line max-len
const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: outputPayloadTemplateFilename,
  config: config[taskName].SyncGranuleOutput
});
const expectedPayload = JSON.parse(fs.readFileSync(templatedOutputPayloadFilename));

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

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the SyncGranules Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
    });

    it('has expected payload', () => {
      expect(lambdaOutput.payload).toEqual(expectedPayload);
    });

    it('has expected updated meta', () => {
      expect(lambdaOutput.meta.input_granules).toEqual(expectedPayload.granules);
    });
  });

  describe('the PostToCmr Lambda', () => {
    let lambdaOutput;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
    });

    it('has expected payload', () => {
      const granule = lambdaOutput.payload.granules[0];
      expect(granule.published).toBe(true);
      expect(granule.cmrLink.startsWith('https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=')).toBe(true);
    });

    it('files move to correct location', () => {
      const granule = lambdaOutput.payload.granules[0];
      const result = conceptExists(granule.cmrLink);

      expect(granule.published).toEqual('true');
      expect(result).not.toEqual(false);

      granule.files.forEach((file) => {
        const params = {
          Bucket: file.bucket,
          Key: file.name
        };

        expect(s3ObjectExists(params).toEqual('true'));

        // await s3().deleteObject({ Bucket: file.bucket, Key: file.key }).promise();
      });
    });
  });
});
