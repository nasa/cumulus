'use strict';

const find = require('lodash.find');
const { ecs } = require('@cumulus/common/aws');
const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterArn
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');
const { loadConfig } = require('../helpers/testUtils');

const workflowName = 'FargateHelloWorld';
const config = loadConfig();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000000;
let clusterArn;

async function getClusterStats({
  statTypes = ['runningFargateTasksCount', 'pendingFargateTasksCount']
}) {
  const stats = (await ecs().describeClusters({
    clusters: [clusterArn],
    include: ['STATISTICS']
  }).promise()).clusters[0].statistics;
  const returnedStats = {};
  statTypes.forEach((statType) => {
    returnedStats[statType] = parseInt(find(stats, ['name', statType]).value, 10);
  });
  return returnedStats;
}

describe('When a task is configured to run in Docker', () => {
  beforeAll(async () => {
    clusterArn = await getClusterArn(config.stackName);
  });

  describe('the load on the system exceeds that which its resources can handle', () => {
    let workflowExecutionArns;
    const numExecutions = 10;

    beforeAll(async () => {
      const workflowExecutionPromises = [...new Array(numExecutions).keys()].map(() => buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        workflowName
      ));
      workflowExecutionArns = await Promise.all(workflowExecutionPromises);
    });

    afterAll(async () => {
      const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
      await Promise.all(completions);
    });

    // Number of tasks using the Fargate launch type, per Region, per account is supposedly 50.
    // But I was able to run more than 50. For Fargate doe we care?
    // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_limits.html
    it('adds new resources able to handle the load and does not add new resources to handle the load', async () => {
      await sleep(5000);
      const stats = await getClusterStats({});
      expect(stats.runningFargateTasksCount + stats.pendingFargateTasksCount).toEqual(numExecutions);
    });
  });

  describe('the load on the system is far below what its resources can handle', () => {
    it('removes excessive resources', async () => {
      const stats = await getClusterStats({});
      expect(stats.runningFargateTasksCount + stats.pendingFargateTasksCount).toEqual(0);
    });

    // and it is at its minimum allowable resources, it does not remove excessive resources
    // A test for ^^ makes sense
    it('does not remove excessive resources', async () => {
      const stats = await getClusterStats({ statTypes: ['runningEC2TasksCount'] });
      expect(stats.runningEC2TasksCount).toEqual(1);
    });
  });
});
