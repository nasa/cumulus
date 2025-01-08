const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');

const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');
const {
  deleteS3Object,
} = require('@cumulus/aws-client/S3');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig } = require('../../helpers/testUtils');

const { setupInitialState, getTargetFiles } = require('./move-granule-collection-spec-utils');

const activityStep = new ActivityStep();

describe('The MoveGranuleCollection workflow using ECS', () => {
  let workflowExecutionArn;
  let config;
  let finalFiles;
  let beforeAllFailed = false;
  afterAll(async () => {
    await Promise.all(finalFiles.map((fileObj) => deleteS3Object(
      fileObj.bucket,
      fileObj.key
    )));
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecutionArn });
  });
  beforeAll(async () => {
    const stackName = config.stackName;
    const sourceUrlPrefix = 'move-granule-collection-testing';
    const targetUrlPrefix = 'move-granule-collection-testing-target';
    config = await loadConfig();
    finalFiles = getTargetFiles(targetUrlPrefix);
    //upload to cumulus
    try {
      await setupInitialState(stackName, sourceUrlPrefix, targetUrlPrefix);

      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        'ECSMoveGranuleCollectionsWorkflow'
      );
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

  it('executes successfully', () => {
    expect(beforeAllFailed).toEqual(false);
  });

  it('outputs the updated granules', async () => {
    expect(beforeAllFailed).toEqual(false);
    const activityOutput = await activityStep.getStepOutput(
      workflowExecutionArn,
      'EcsTaskMoveGranuleCollections'
    );
    expect(activityOutput.payload).toEqual({
      granules: [
        {
          status: 'completed',
          collectionId: 'MOD11A2___006',
          granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
          files: [
            {
              key: 'move-granule-collection-testing-target/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
              bucket: 'cumulus-test-sandbox-protected',
              type: 'data',
              fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
            },
            {
              key: 'move-granule-collection-testing-target/jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
              bucket: 'cumulus-test-sandbox-public',
              type: 'browse',
              fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
            },
            {
              key: 'move-granule-collection-testing-target/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
              bucket: 'cumulus-test-sandbox-public',
              type: 'browse',
              fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
            },
            {
              key: 'move-granule-collection-testing-target/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
              bucket: 'cumulus-test-sandbox-public',
              type: 'metadata',
              fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
            },
          ],
        },
      ],
    });
  });
});
