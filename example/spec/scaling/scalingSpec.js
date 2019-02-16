'use strict';

const _ = require('lodash');
const { Execution } = require('@cumulus/api/models');
const { ecs } = require('@cumulus/common/aws');
const {
  buildAndStartWorkflow,
  LambdaStep,
  waitForCompletedExecution,
  getClusterArn
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');
const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  isCumulusLogEntry
} = require('../helpers/testUtils');

const workflowName = 'FargateHelloWorld';
const config = loadConfig();
const testId = createTimestampedTestId(config.stackName, workflowName);
const testSuffix = createTestSuffix(testId);
const lambdaStep = new LambdaStep();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000000;
process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
const executionModel = new Execution();
let clusterArn;

async function getClusterStats({
  clusterArn,
  statTypes = ['runningFargateTasksCount', 'pendingFargateTasksCount']
}) {
  const stats = (await ecs().describeClusters({
    clusters: [ clusterArn ],
    include: [ 'STATISTICS' ]
  }).promise()).clusters[0].statistics;
  let returnedStats = {};
  statTypes.forEach((statType) => {
    returnedStats[statType] = parseInt(_.find(stats, x => x['name'] === statType).value);
  });
  return returnedStats;
};

describe('When a task is configured to run in Docker', () => {
  beforeAll(async () => {
    clusterArn = await getClusterArn(config.stackName);
  });

  describe('the load on the system exceeds that which its resources can handle', () => {
    let workflowExecutionArns;
    let taskArn = 'arn';
    let numExecutions = 10;
    let startTime = new Date();

    beforeAll(async () => {
      const workflowExecutionPromises = [...Array(numExecutions).keys()].map(() => {
        return buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          workflowName
        );
      });
      workflowExecutionArns = await Promise.all(workflowExecutionPromises);        
    });

    afterAll(async () => {
      const completions = workflowExecutionArns.map((executionArn) => {
        return waitForCompletedExecution(executionArn);
      });
      await Promise.all(completions);
    });

    // Number of tasks using the Fargate launch type, per Region, per account is supposedly 50.
    // But I was able to run more than 50. For Fargate doe we care?
    // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_limits.html
    it('adds new resources able to handle the load and does not add new resources to handle the load', async () => {
      await sleep(5000);
      const stats = await getClusterStats({clusterArn});
      expect(stats.runningFargateTasksCount + stats.pendingFargateTasksCount).toEqual(numExecutions);
    });
  });

  describe('the load on the system is far below what its resources can handle', () => {
    it('removes excessive resources', async () => {
      const stats = await getClusterStats({clusterArn});
      expect(stats.runningFargateTasksCount + stats.pendingFargateTasksCount).toEqual(0);
    });

    // and it is at its minimum allowable resources, it does not remove excessive resources
    // A test for ^^ makes sense
    it('does not remove excessive resources', async () => {
      const stats = await getClusterStats({clusterArn, stats: ['runningEC2TasksCount'] });
      expect(stats.runningEC2TasksCount).toEqual(1);
    });
  });
});

