const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const fs = require('fs');
const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');
const {
  deleteS3Object,
} = require('@cumulus/aws-client/S3');
const { createProvider } = require('@cumulus/api-client/providers');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig, createTestSuffix, createTimestampedTestId } = require('../../helpers/testUtils');
const { setupInitialState, getTargetFiles, getTargetCollection, getSourceCollection, getPayload } = require('./move-granule-collection-spec-utils');

const activityStep = new ActivityStep();

describe('The ChangeGranuleCollectionS3 workflow using ECS', () => {
  let workflowExecutionArn;
  let config;
  let finalFiles;
  let beforeAllFailed = false;
  const granuleIds = ['MOD11A1.A2017200.h19v04.006.2017201090724'];
  afterAll(async () => {
    try {
      await Promise.all(finalFiles.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      )));
    } catch {
      console.log('no need to delete s3 objects');
    }
    try {
      await Promise.all(granuleIds.map((granuleId) => deleteGranule({ prefix: config.stackName, granuleId })));
    } catch {
      console.log('no need to delete granules');
    }

    try {
      await deleteExecution({ prefix: config.stackName, executionArn: workflowExecutionArn });
    } catch {
      console.log('no need to delete execution');
    }
  });
  beforeAll(async () => {
    const sourceUrlPrefix = 'change-granule-collection-s3-testing';
    const targetUrlPrefix = 'change-granule-collection-s3-testing-target';
    config = await loadConfig();
    const providersDir = './data/providers/s3/';
    const stackName = config.stackName;
    const testId = createTimestampedTestId(config.stackName, 'ChangeGranuleCollectionS3');
    const testSuffix = createTestSuffix(testId);
    const provider = { id: `s3_provider${testSuffix}` };

    const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
    const providerData = {
      ...providerJson,
      id: provider.id,
      host: config.bucket,
    };
    await createProvider({ prefix: config.stackName, provider: providerData });

    finalFiles = getTargetFiles(targetUrlPrefix, config);
    //upload to cumulus

    try {
      await setupInitialState(stackName, sourceUrlPrefix, targetUrlPrefix, config);

      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        'MoveGranuleCollectionsWorkflow',
        getSourceCollection(sourceUrlPrefix),
        provider,
        getPayload(sourceUrlPrefix, targetUrlPrefix, config).input,
        getPayload(sourceUrlPrefix, targetUrlPrefix, config).meta
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
      'EcsTaskChangeGranuleCollectionS3'
    );
    expect(activityOutput.payload.granules[0].files).toEqual([
      {
        key: 'change-granule-collection-s3-testing-target/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        bucket: config.buckets.protected.name,
        type: 'data',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      },
      {
        key: 'change-granule-collection-s3-testing-target/jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        bucket: config.buckets.public.name,
        type: 'browse',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
      },
      {
        key: 'change-granule-collection-s3-testing-target/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        bucket: config.buckets.public.name,
        type: 'browse',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
      },
      {
        key: 'change-granule-collection-s3-testing-target/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: config.buckets.public.name,
        type: 'metadata',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      },
    ]);
    expect(activityOutput.payload.granules[0].granuleId).toEqual('MOD11A1.A2017200.h19v04.006.2017201090724');
  });
});
