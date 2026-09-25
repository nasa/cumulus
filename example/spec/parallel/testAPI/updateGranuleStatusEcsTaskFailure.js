const Logger = require('@cumulus/logger');
const log = new Logger({
  sender: '@cumulus/message/IntegrationTests',
});

const { deleteGranule, createGranule, getGranule } = require('@cumulus/api-client/granules');
const { deleteExecution, getExecution } = require('@cumulus/api-client/executions');
const providerApi = require('@cumulus/api-client/providers');
const collectionsApi = require('@cumulus/api-client/collections');

const {
  addCollections,
  addProviders,
} = require('@cumulus/integration-tests');

const { ECSClient, DescribeServicesCommand } = require('@aws-sdk/client-ecs');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
} = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');

const workflowName = 'HelloWorldEcsFailWorkflow';
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
            version: collection.version,
            files: [],
          },
        ],
      };
      // create collection + provider in for the granule
      await Promise.all([
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
        addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
        createGranule({
          prefix: config.stackName,
          body: inputPayload,
        }),
      ]);

      const ecs = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });
      const service = await ecs.send(new DescribeServicesCommand({
        cluster: `${config.stackName}-CumulusECSCluster`,
        services: [`${config.stackName}-HelloWorldEcsFailWorkflow`],
      }));

      expect(service.services[0].desiredCount).toBe(1);
      expect(service.services[0].runningCount).toBe(1);
      expect(service.services[0].pendingCount).toBe(0);

      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload
      );
      granuleParams = {
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId,
      };
      const runningGranule = await waitForApiStatus(
        getGranule,
        granuleParams,
        ['running']
      );

      expect(runningGranule.status).toEqual('running');

      // assert granule status in PG == 'running'
    } catch (error) {
      log.error('Error in beforeAll:', error);
      beforeAllError = error;
    }
  });
  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });
  afterAll(async () => {
    try {
      log.debug('deleting granule, collection, provider');
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
    } catch (error) {
      log.error('Error in afterAll:', error);
    }
    // clean up db - delete granule, collection, provider, execution records
  });

  it("failed ECS task results in granule status going to 'failed' state", () => {
    if (beforeAllError) throw SetupError;
    // check the execution failed
    const failedExecution = waitForApiStatus(
      getExecution,
      {
        prefix: config.stackName,
        arn: workflowExecutionArn,
      },
      'failed'
    );
    expect(failedExecution.status).toEqual('failed');

    // check the granule status was moved to 'failed' as we expect and not stuck on 'running'
    const failedGranule = waitForApiStatus(
      getGranule,
      granuleParams
    );
    expect(failedGranule.status).toEqual('failed');
    // veryfiy granule status and execution status match
    expect(failedGranule.status).toEqual(failedExecution.status);
  });
});
