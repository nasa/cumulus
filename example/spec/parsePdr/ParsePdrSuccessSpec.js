const fs = require('fs');
const { S3 } = require('aws-sdk');
const {
  buildAndExecuteWorkflow,
  waitForCompletedExecution,
  LambdaStep
} = require('@cumulus/integration-tests');

const { loadConfig } = require('../helpers/testUtils');

const s3 = new S3();
const config = loadConfig();
const lambdaStep = new LambdaStep();

const taskName = 'ParsePdr';

const expectedParsePdrOutput = JSON.parse(fs.readFileSync('./spec/parsePdr/ParsePdr.output.json'));
const pdrFilename = 'MOD09GQ_1granule_v3.PDR';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

describe('Parse PDR workflow', () => {
  let workflowExecution;
  let pdrStatusCheckOutput;
  const inputPayloadFilename = './spec/parsePdr/ParsePdr.input.payload.json';
  const inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename));
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };

  beforeAll(async () => {
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload);

    pdrStatusCheckOutput = await lambdaStep.getStepOutput(
      workflowExecution.executionArn,
      'PdrStatusCheck'
    );
  });

  afterAll(() => Promise.all([
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
  describe('SfSnsReport lambda function', () => {
    let lambdaOutput;
    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SfSnsReport');
    });

    it('has expected output message', () => {
      expect(lambdaOutput.payload.messageId).not.toBeNull();
    });
  });

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
