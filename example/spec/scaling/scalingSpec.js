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

const workflowName = 'EcsHelloWorld';
const config = loadConfig();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000000;
let clusterArn;

async function getClusterStats({
  statTypes = ['runningEcsTasksCount', 'pendingEcsTasksCount']
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

    it('adds new resources able to handle the load and does not add new resources to handle the load', async () => {
      await sleep(5000);
      const stats = await getClusterStats({});
      expect(stats.runningEcsTasksCount + stats.pendingEcsTasksCount).toEqual(numExecutions);
    });

    // more ecs instances should spin up if the current ecs instance can't handle the load
  });

  describe('the load on the system is far below what its resources can handle', () => {
    it('removes excessive resources', async () => {
      const stats = await getClusterStats({});
      expect(stats.runningEcsTasksCount + stats.pendingEcsTasksCount).toEqual(0);
    });

    it('does not remove excessive resources', async () => {
      const stats = await getClusterStats({ statTypes: ['runningEC2TasksCount'] });
      expect(stats.runningEC2TasksCount).toEqual(1);
    });
  });
});
