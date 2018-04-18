const fs = require('fs');
const { S3 } = require('aws-sdk');
const {
  executeWorkflow,
  waitForCompletedExecution,
  LambdaStep
} = require('@cumulus/integration-tests');

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

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

const collectionConfigStore = new CollectionConfigStore(config.bucket, config.stackName);

describe('Parse PDR workflow', () => {
  let workflowExecution;
  let pdrStatusCheckOutput;

  beforeAll(async () => {
    await collectionConfigStore.put(
      'MOD09GQ',
      { name: 'MOD09GQ', granuleIdExtraction: '(.*)', files: [] }
    );

    workflowExecution = await executeWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      templatedInputFilename
    );

    pdrStatusCheckOutput = await lambdaStep.getStepOutput(
      workflowExecution.executionArn,
      'PdrStatusCheck'
    );
  });

  afterAll(() => Promise.all([
    collectionConfigStore.delete('MOD09GQ'),
    s3.deleteObject({
      Bucket: config.bucket,
      Key: `${config.stackName}/pdrs/${pdrFilename}`
    }).promise()
  ]));

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('ParsePdr lambda function', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'ParsePdr');
    });

    it('has expected path and name output', () => {
      expect(lambdaOutput.payload).toEqual(expectedParsePdrOutput);
    });
  });

  describe('QueueGranules lambda function', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'QueueGranules'
      );
    });

    it('has expected pdr and arns output', () => {
      expect(lambdaOutput.payload.running.length).toEqual(1);
      expect(lambdaOutput.payload.pdr).toEqual(expectedParsePdrOutput.pdr);
    });
  });

  describe('PdrStatusCheck lambda function', () => {
    it('has expected output', () => {
      const payload = pdrStatusCheckOutput.payload;
      expect(payload.running.concat(payload.completed, payload.failed).length).toEqual(1);
      expect(payload.pdr).toEqual(expectedParsePdrOutput.pdr);
    });
  });

  // TODO Get this working after CUMULUS-524 has been addressed
  // describe('SfSnsReport lambda function', () => {
  //   it('has expected output', async () => {
  //     const lambdaOutput = await lambdaStep.getStepOutput(
  //       workflowExecution.executionArn,
  //       'SfSnsReport'
  //     );

  //     // TODO Somehow the lambdaOutput.payload is null and this is different from what's in AWS console.
  //     // Maybe it's caused by 'ResultPath: null', we want to keep the input as the output
  //   });
  // });

  /**
   * The parse pdr workflow kicks off a granule ingest workflow, so check that the
   * granule ingest workflow completes successfully. Above, we checked that there is
   * one running task, which is the sync granule workflow. The payload has the arn of the
   * running workflow, so use that to get the status.
   */
  describe('IngestGranule workflow', () => {
    let ingestGranuleWorkflowArn;
    let ingestGranuleExecutionStatus;

    beforeAll(async () => {
      ingestGranuleWorkflowArn = pdrStatusCheckOutput.payload.running[0];
      ingestGranuleExecutionStatus = await waitForCompletedExecution(ingestGranuleWorkflowArn);
    });

    it('executes successfully', () => {
      expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
    });

    describe('SyncGranule lambda function', () => {
      it('outputs 1 granule', async () => {
        const lambdaOutput = await lambdaStep.getStepOutput(
          ingestGranuleWorkflowArn,
          'SyncGranule'
        );
        expect(lambdaOutput.payload.granules.length).toEqual(1);
      });
    });
  });
});
