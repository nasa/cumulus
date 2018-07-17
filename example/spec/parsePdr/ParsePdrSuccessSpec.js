const fs = require('fs');
const { Pdr, Execution } = require('@cumulus/api/models');
const {
  buildAndExecuteWorkflow,
  waitForCompletedExecution,
  LambdaStep,
  api: apiTestUtils
} = require('@cumulus/integration-tests');

const { loadConfig, getExecutionUrl } = require('../helpers/testUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();

const taskName = 'ParsePdr';

const expectedParsePdrOutput = JSON.parse(fs.readFileSync('./spec/parsePdr/ParsePdr.output.json'));

describe('Parse PDR workflow', () => {
  let workflowExecution;
  let queueGranulesOutput;
  const inputPayloadFilename = './spec/parsePdr/ParsePdr.input.payload.json';
  const inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename));
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };

  process.env.PdrsTable = `${config.stackName}-PdrsTable`;
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  const pdrModel = new Pdr();
  const executionModel = new Execution();

  beforeAll(async () => {
    // delete the pdr record from DynamoDB if exists
    await pdrModel.delete({ pdrName: inputPayload.pdr.name });

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      collection,
      provider,
      inputPayload
    );

    queueGranulesOutput = await lambdaStep.getStepOutput(
      workflowExecution.executionArn,
      'QueueGranules'
    );
  });

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
    it('has expected pdr and arns output', () => {
      expect(queueGranulesOutput.payload.running.length).toEqual(1);
      expect(queueGranulesOutput.payload.pdr).toEqual(expectedParsePdrOutput.pdr);
    });
  });

  describe('PdrStatusCheck lambda function', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'PdrStatusCheck'
      );
    });

    it('has expected output', () => {
      const payload = lambdaOutput.payload;
      expect(payload.running.concat(payload.completed, payload.failed).length).toEqual(1);
      expect(payload.pdr).toEqual(expectedParsePdrOutput.pdr);
    });
  });

  describe('SfSnsReport lambda function', () => {
    let lambdaOutput;
    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SfSnsReport');
    });

    // SfSnsReport lambda is used in the workflow multiple times, appearantly, only the first output
    // is retrieved which is the first step (StatusReport)
    it('has expected output message', () => {
      expect(lambdaOutput.payload).toEqual(inputPayload);
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
      ingestGranuleWorkflowArn = queueGranulesOutput.payload.running[0];
      ingestGranuleExecutionStatus = await waitForCompletedExecution(ingestGranuleWorkflowArn);
    });

    it('executes successfully', () => {
      expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
    });

    describe('SyncGranule lambda function', () => {
      it('outputs 1 granule and pdr', async () => {
        const lambdaOutput = await lambdaStep.getStepOutput(
          ingestGranuleWorkflowArn,
          'SyncGranule'
        );
        expect(lambdaOutput.payload.granules.length).toEqual(1);
        expect(lambdaOutput.payload.pdr).toEqual(lambdaOutput.payload.pdr);
      });
    });
  });

  /** This test relies on the previous 'IngestGranule workflow' to complete */
  describe('When accessing an execution via the API that was triggered from a parent step function', () => {
    it('displays a link to the parent', async () => {
      const ingestGranuleWorkflowArn = queueGranulesOutput.payload.running[0];
      const ingestGranuleExecution = await apiTestUtils.getExecution({
        prefix: config.stackName,
        arn: ingestGranuleWorkflowArn
      });

      expect(ingestGranuleExecution.parentArn).toEqual(workflowExecution.executionArn);
    });
  });

  describe('When accessing an execution via the API that was not triggered from a parent step function', () => {
    it('does not display a parent link', async () => {
      const parsePdrExecution = await apiTestUtils.getExecution({
        prefix: config.stackName,
        arn: workflowExecution.executionArn
      });

      expect(parsePdrExecution.parentArn).toBeUndefined();
    });
  });


  describe('the sf-sns-report task has published a sns message and', () => {
    it('the pdr record is added to DynamoDB', async () => {
      const record = await pdrModel.get({ pdrName: inputPayload.pdr.name });
      expect(record.execution).toEqual(getExecutionUrl(workflowExecution.executionArn));
      expect(record.status).toEqual('completed');
    });

    it('the execution record is added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: workflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });
});
