const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { getExecution } = require('@cumulus/api-client/executions');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig } = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const { getTargetCollection, getProcessGranule, setupInitialState, getPayload, getTargetFiles } = require('./move-granule-collection-spec-utils')
const {
  deleteS3Object,
} = require('@cumulus/aws-client/S3');

const activityStep = new ActivityStep();

describe('The MoveGranuleCollection workflow using ECS', () => {
  let workflowExecution;
  let config;
  let finalFiles;
  let beforeAllFailed = false;
  afterAll(async () => {
    await Promise.all(finalFiles.map((fileObj) => deleteS3Object(
      fileObj.bucket,
      fileObj.key
    )));
  });
  beforeAll(async () => {
    let stackName;
    const sourceUrlPrefix = `move-granule-collection-testing`;
    const targetUrlPrefix = `move-granule-collection-testing-target`;
    const targetCollection = getTargetCollection(targetUrlPrefix);
    const processGranule = getProcessGranule(sourceUrlPrefix)
    
    config = await loadConfig();
    stackName = config.stackName;
    finalFiles = getTargetFiles(targetUrlPrefix)
    const payload = getPayload(sourceUrlPrefix, targetUrlPrefix);
    //upload to cumulus
    try {
      await setupInitialState(stackName, sourceUrlPrefix, targetUrlPrefix);

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        'ECSMoveGranuleCollectionsWorkflow'
      );
  
      console.log(JSON.stringify(workflowExecution, null, 2))
      await Promise.all(finalFiles.map((file) => expectAsync(
        waitForListObjectsV2ResultCount({
          bucket: file.bucket,
          prefix: file.key,
          desiredCount: 1,
          interval: 5 * 1000,
          timeout: 60 * 1000,
        })
      ).toBeResolved()));
    } catch (error) {
      console.log(`files do not appear to have been moved: error: ${error}`);
      beforeAllFailed = true;
    }


    
  });

  afterAll(async () => {
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('completed');
  });

  describe('the moveGranuleCollections ECS', () => {
    let activityOutput;

    beforeAll(async () => {
      activityOutput = await activityStep.getStepOutput(
        workflowExecution.executionArn,
        'EcsTaskMoveGranuleCollections'
      );
      console.log(JSON.stringify(activityOutput, null, 2))
    });

    it('output is Hello World', () => {
      expect(activityOutput.payload).toEqual({ hello: 'Hello World' });
    });
  });

  // describe('the reporting lambda has received the cloudwatch stepfunction event and', () => {
  //   it('the execution record is added to the PostgreSQL database', async () => {
  //     const record = await waitForApiStatus(
  //       getExecution,
  //       {
  //         prefix: config.stackName,
  //         arn: workflowExecution.executionArn,
  //       },
  //       'completed'
  //     );
  //     expect(record.status).toEqual('completed');
  //   });
  // });
});
