const Logger = require('@cumulus/logger');
const log = new Logger({
  sender: '@cumulus/message/IntegrationTests',
});

const { deleteGranule, createGranule, getGranule } = require('@cumulus/api-client/granules');
const { deleteExecution, getExecution } = require('@cumulus/api-client/executions');
const providerApi = require('@cumulus/api-client/providers');
const collectionsApi = require('@cumulus/api-client/collections');
const { lastFailedEventStep } = require('@cumulus/message/StepFunctions');
const { getExecutionHistory } = require('@cumulus/aws-client/StepFunctions');
const {
  addCollections,
  addProviders,
} = require('@cumulus/integration-tests');

const { ECSClient, DescribeClustersCommand } = require('@aws-sdk/client-ecs');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
} = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');

const workflowName = 'EcsFailWorkflow';
const SetupError = new Error('Test setup failed');

describe('Granules status in Postgres is correctly updated in the event of a workflow failing on a failed ECS task', () => {
  let beforeAllError;
  let config;
  let collection;
  let granuleParams;
  let provider;
  let workflowExecutionArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      const providersDir = './data/providers/s3/';
      const collectionsDir = './data/collections/s3_MOD09GQ_006';
      const testId = createTimestampedTestId(config.stackName, 'GranuleStatusUpdateEcsTaskFailed');
      const testSuffix = createTestSuffix(testId);

      collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      const collectionId = constructCollectionId(collection.name, collection.version);
      provider = { id: `s3_provider${testSuffix}` };
      const granuleId = `MOD09GQ.A0000001.TEST01.006.${Date.now()}`;

      const inputPayload = {
        granules: [
          {
            granuleId,
            dataType: collection.name,
            status: 'queued',
            collectionId: collectionId,
            producerGranuleId: 'integration-test-producter',
            files: [],
          },
        ],
      };

      granuleParams = {
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId,
      };
      // create collection + provider in for the granule
      log.debug('starting collection and provider DB write');
      await addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId);
      await addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix);
      log.debug('finished creating collection and provider in DB, adding initial granule to be "updated"');
      await createGranule({
        prefix: config.stackName,
        body: inputPayload.granules[0],
      });
      log.debug('wrote granule');

      // validate cluster health
      const ecs = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });
      const ecsService = await ecs.send(new DescribeClustersCommand({
        cluster: `${config.stackName}-CumulusECSCluster`,
      }));
      expect(ecsService.clusters[0].status).toBe('ACTIVE');

      log.debug('starting workflow, not waiting for workflow completion');
      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload
      );

      const runningGranule = await waitForApiStatus(
        getGranule,
        granuleParams,
        ['running']
      );

      expect(runningGranule.status).toEqual('running');
    } catch (error) {
      log.error('Error in beforeAll:', error);
      beforeAllError = error;
    }
  });

  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });

  afterAll(async () => {
    // DB cleanup post test
    await deleteGranule(granuleParams);
    await deleteExecution({
      prefix: config.stackName,
      executionArn: workflowExecutionArn,
    });
    await providerApi.deleteProvider({
      prefix: config.stackName,
      providerId: provider.id,
    });
    await collectionsApi.deleteCollection({
      prefix: config.stackName,
      collectionName: collection.name,
      collectionVersion: collection.version,
    });
    log.debug('afterAll deleted all resources');
  });

  it("failed ECS task results in granule status going to 'failed' state", async () => {
    if (beforeAllError) throw SetupError;
    // check the workflow execution failed
    const failedExecution = await waitForApiStatus(
      getExecution,
      {
        prefix: config.stackName,
        arn: workflowExecutionArn,
      },
      'failed'
    );
    expect(failedExecution.status).toEqual('failed');

    // validate that it was an ECS task failure that crashed workflow
    const { events } = await getExecutionHistory({ executionArn: workflowExecutionArn });
    const lastFailedEvent = lastFailedEventStep(events);
    expect(lastFailedEvent.type).toEqual('TaskFailed');

    // check the granule status was moved to 'failed' as we expect and not stuck on 'running'
    const failedGranule = await waitForApiStatus(
      getGranule,
      granuleParams,
      'failed'
    );
    expect(failedGranule.status).toEqual('failed');
    // Essential check that execution status and granule status match
    expect(failedGranule.status).toEqual(failedExecution.status);
  });
});
