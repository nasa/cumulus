const fs = require('fs');
const { get } = require('lodash');
const { Pdr, Execution } = require('@cumulus/api/models');
const {
  buildAndExecuteWorkflow,
  waitForCompletedExecution,
  LambdaStep,
  api: apiTestUtils
} = require('@cumulus/integration-tests');
const { aws: { s3, getS3Object } } = require('@cumulus/common');


const { loadConfig, uploadTestDataToBucket, deleteFolder, getExecutionUrl } = require('../helpers/testUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();

const taskName = 'ParsePdr';

const expectedParsePdrOutput = JSON.parse(fs.readFileSync('./spec/parsePdr/ParsePdr.output.json'));

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3.PDR',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
  '@cumulus/test-data/granules/L2_HR_PIXC_product_0001-of-4154.h5'
];

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
    // place pdr on S3
    uploadTestDataToBucket(config.bucket, s3data);

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

  afterAll(async () => {
    // delete the pdr record from DynamoDB if exists
    await pdrModel.delete({ pdrName: inputPayload.pdr.name });
    // delete test data from S3
    await deleteFolder(config.bucket, `cumulus-test-data/pdrs`);
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

    afterAll(async () => {
      // cleanup
      let finalOutput = await lambdaStep.getStepOutput(ingestGranuleWorkflowArn, 'StopStatus');
      if (finalOutput.replace) {
        const msg = await getS3Object(finalOutput.replace.Bucket, finalOutput.replace.Key);
        finalOutput = JSON.parse(msg.Body.toString());
      }
      // delete ingested granule(s)
      await Promise.all(
        finalOutput.payload.granules.map((g) => {
          apiTestUtils.deleteGranule({
            prefix: config.stackName,
            granuleId: g.granuleId
          });
        })
      );
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

  describe('When a workflow is configured to make a choice based on the output of a Cumulus task', () => {
    let executionStatus;

    beforeAll(async () => {
      const executionArn = workflowExecution.executionArn;
      executionStatus = await apiTestUtils.getExecutionStatus({
        prefix: config.stackName,
        arn: executionArn
      });
    });

    it('branches according to the CMA output', async () => {
      expect(executionStatus.executionHistory).toBeTruthy();
      const events = executionStatus.executionHistory.events;

      // the output of the CheckStatus is used to determine the task of choice
      const checkStatusTaskName = 'CheckStatus';
      const stopStatusTaskName = 'StopStatus';
      const pdrStatusReportTaskName = 'PdrStatusReport';

      let choiceVerified = false;
      for (let i = 0; i < events.length; i += 1) {
        const currentEvent = events[i];
        if (currentEvent.type === 'TaskStateExited' &&
        get(currentEvent, 'stateExitedEventDetails.name') === checkStatusTaskName) {
          const output = JSON.parse(get(currentEvent, 'stateExitedEventDetails.output'));
          const isFinished = output.payload.isFinished;

          // get the next task executed
          let nextTask;
          while (!nextTask && i < events.length - 1) {
            i += 1;
            const nextEvent = events[i];
            if (nextEvent.type === 'TaskStateEntered' &&
              get(nextEvent, 'stateEnteredEventDetails.name')) {
              nextTask = get(nextEvent, 'stateEnteredEventDetails.name');
            }
          }

          expect(nextTask).toBeTruthy();

          if (isFinished === true) {
            expect(nextTask).toEqual(stopStatusTaskName);
          }
          else {
            expect(nextTask).toEqual(pdrStatusReportTaskName);
          }
          choiceVerified = true;
        }
      }

      expect(choiceVerified).toBe(true);
    });
  });
});
