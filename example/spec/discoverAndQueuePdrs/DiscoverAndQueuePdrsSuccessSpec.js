const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { loadConfig, deleteFolder } = require('../helpers/testUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();

const taskName = 'DiscoverAndQueuePdrs';

const pdrFilename = 'MOD09GQ_1granule_v3.PDR';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

describe('The Discover And Queue PDRs workflow', () => {
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  let workflowExecution;

  beforeAll(async () => {
    await deleteFolder(config.bucket, `${config.stackName}/pdrs`);
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      collection,
      provider
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the DiscoverPdrs Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'DiscoverPdrs');
    });

    it('has expected path and name output', () => {
      expect(lambdaOutput.payload.pdrs[0].path).toEqual('cumulus-test-data/pdrs');
      expect(lambdaOutput.payload.pdrs[0].name).toEqual(pdrFilename);
    });
  });

  describe('the QueuePdrs Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'QueuePdrs');
    });

    it('output is pdrs_queued', () => {
      expect(lambdaOutput.payload).toEqual({ pdrs_queued: 1 });
    });
  });
});
