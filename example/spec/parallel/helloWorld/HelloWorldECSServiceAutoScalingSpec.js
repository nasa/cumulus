const range = require('lodash.range');
const { sleep } = require('@cumulus/common/util');
const { getEcsServiceEvents } = require('@cumulus/common/ecs');
const { buildAndExecuteWorkflow, getEcsClusterArn, getEcsServiceArn } = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');

const awsConfig = loadConfig();

describe('The Hello World workflow using ECS and CMA Layers', () => {
  let workflowExecutions = [];
  const startTime = new Date();

  beforeAll(async () => {
    const workflows = range(15).map(() =>
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
    await sleep(180 * 1000);
    const cluster = await getEcsClusterArn(awsConfig.stackName);
    const service = await getEcsServiceArn(cluster, awsConfig.stackName, 'EcsTaskHelloWorld');
    console.log('getEcsServiceEvents', cluster, service, startTime);
    const serviceEvents = await getEcsServiceEvents(cluster, service, startTime);
    expect(serviceEvents.length).toBeGreaterThan(2);
    expect(serviceEvents.filter((event) => event.message.includes('has started 1 tasks')).length).toBeGreaterThanOrEqual(1);
    expect(serviceEvents.filter((event) => event.message.includes('has stopped 1 running tasks')).length).toBeGreaterThanOrEqual(1);
  });
});
