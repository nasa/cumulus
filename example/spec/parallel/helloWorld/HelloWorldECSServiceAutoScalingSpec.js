const range = require('lodash.range');
const { sleep } = require('@cumulus/common/util');
const { buildAndExecuteWorkflow } = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');
const { getEcsClusterService, getServiceEvents } = require('../../helpers/ecsUtils');

const awsConfig = loadConfig();

describe('The Hello World workflow using ECS and CMA Layers', () => {
  let workflowExecutions = [];
  const startTime = new Date();

  beforeAll(async () => {
    const workflows = range(20).map(() =>
      buildAndExecuteWorkflow(
        awsConfig.stackName,
        awsConfig.bucket,
        'EcsHelloWorldWorkflow',
        null,
        null,
        { taskDurationInSecs: 15 }
      ));
    workflowExecutions = await Promise.all(workflows);
  });

  it('executes successfully', () => {
    workflowExecutions.forEach((workflowExecution) => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });
  });

  it('performs ECS Service Autoscaling', async () => {
    // wait for the event messages
    await sleep(120 * 1000);
    const { cluster, service } = await getEcsClusterService(awsConfig.stackName, 'EcsTaskHelloWorld');
    const serviceEvents = await getServiceEvents(cluster, service, startTime);
    expect(serviceEvents.length).toBeGreaterThan(1);
    expect(serviceEvents.filter((event) => event.message.includes('has started 1 tasks')).length).toBeGreaterThanOrEqual(1);
    expect(serviceEvents.filter((event) => event.message.includes('has stopped 1 running tasks')).length).toBeGreaterThanOrEqual(1);
  });
});
