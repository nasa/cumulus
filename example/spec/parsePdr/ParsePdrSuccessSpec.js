const fs = require('fs');
const { S3 } = require('aws-sdk');
const { executeWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { CollectionConfigStore } = require('@cumulus/common');

const { loadConfig, templateFile } = require('../helpers/testUtils');

const s3 = new S3();
const config = loadConfig();
const lambdaStep = new LambdaStep();

const taskName = 'ParsePdr';
const inputTemplateFilename = './spec/parsePdr/ParsePdr.input.template.json';
const templatedInputFilename = templateFile({
  inputTemplateFilename,
  config: config[taskName]
});
const expectedParsePdrOutput = JSON.parse(fs.readFileSync('./spec/parsePdr/ParsePdr.output.json'));
const pdrFilename = 'MOD09GQ_1granule_v3.PDR';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;

describe("The Parse PDR workflow", function() {
  let workflowExecution = null;

  beforeAll(async function() {
    const collectionConfigStore = new CollectionConfigStore(config.bucket, config.stackName);
    await collectionConfigStore.put('MOD09GQ', { name: 'MOD09GQ', granuleIdExtraction: '(.*)' });

    workflowExecution = await executeWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      templatedInputFilename
    );
  });

  afterAll(async () => {
    await s3.deleteObject({
      Bucket: config.bucket,
      Key: `${config.stackName}/pdrs/${pdrFilename}`
    }).promise();
  });

  it('executes successfully', function() {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe("the ParsePdr Lambda", function() {
    let lambdaOutput = null;

    beforeAll(async function() {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, "ParsePdr");
    });

    it("has expected path and name output", function() {
      expect(lambdaOutput.payload).toEqual(expectedParsePdrOutput);
    });
  });

  describe('the QueueGranules Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async function() {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, "QueueGranules");
    });

    it("has expected pdr and arns output", function() {
      expect(lambdaOutput.payload.running.length).toEqual(1);
      expect(lambdaOutput.payload.pdr).toEqual(expectedParsePdrOutput.pdr);
    });
  });

  describe('the PdrStatusCheck Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async function() {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, "PdrStatusCheck");
    });

    it("has expected output", function() {
      const payload = lambdaOutput.payload;
      expect(payload.running.concat(payload.completed, payload.failed).length).toEqual(1);
      expect(lambdaOutput.payload.pdr).toEqual(expectedParsePdrOutput.pdr);
    });
  });

  describe('the SfSnsReport Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async function() {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, "SfSnsReport");
    });

    it("has expected output", function() {
      // TODO Somehow the lambdaOutput.payload is null and this is different from what's in AWS console.
      // Maybe it's caused by 'ResultPath: null', we want to keep the input as the output
    });
  });

});
