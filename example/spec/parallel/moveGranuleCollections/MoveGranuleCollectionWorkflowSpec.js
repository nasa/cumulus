const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { getExecution } = require('@cumulus/api-client/executions');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig } = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');

const activityStep = new ActivityStep();

describe('The MoveGranuleCollection workflow using ECS', () => {
  let workflowExecution;
  let config;

  beforeAll(async () => {
    try {
      await collections.createCollection({
        prefix: stackName,
        collection: originalCollection,
      });
    } catch {
      console.log(`collection ${constructCollectionId(y.name, originalCollection.version)} already exists`);
    }
    try {
      await collections.createCollection({
        prefix: stackName,
        collection: targetCollection,
      });
    } catch {
      console.log(`collection ${constructCollectionId(targetCollection.name, targetCollection.version)} already exists`);
    }
    try {
      await granules.createGranule({
        prefix: stackName,
        body: processGranule,
      });
    } catch {
      console.log(`granule ${processGranule.granuleId} already exists`);
    }
    await Promise.all(processGranule.files.map(async (file) => {
      let body;
      if (file.type === 'metadata') {
        body = fs.createReadStream(path.join(__dirname, 'data/meta.xml'));
      } else {
        body = file.key;
      }
      await promiseS3Upload({
        params: {
          Bucket: file.bucket,
          Key: file.key,
          Body: body,
        },
      });
    }));
    
    config = await loadConfig();




    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      'ECSMoveGranuleCollectionsWorkflow'
    );

    console.log(JSON.stringify(workflowExecution, null, 2))
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

  describe('the reporting lambda has received the cloudwatch stepfunction event and', () => {
    it('the execution record is added to the PostgreSQL database', async () => {
      const record = await waitForApiStatus(
        getExecution,
        {
          prefix: config.stackName,
          arn: workflowExecution.executionArn,
        },
        'completed'
      );
      expect(record.status).toEqual('completed');
    });
  });
});
