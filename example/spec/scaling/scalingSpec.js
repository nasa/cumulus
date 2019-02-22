'use strict';

const find = require('lodash.find');
const { autoscaling, ecs } = require('@cumulus/common/aws');
const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterArn
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');
const { loadConfig } = require('../helpers/testUtils');

const workflowName = 'HelloWorldOnDemandWorkflow';
const config = loadConfig();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000000;
let clusterArn;
let autoScalingGroupName;

async function getClusterStats({
  statTypes = ['runningEC2TasksCount', 'pendingEC2TasksCount']
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
};

async function getAutoScalingGroupName(stackName) {
  const autoScalingGroups = (await autoscaling().describeAutoScalingGroups({}).promise()).AutoScalingGroups;
  const asg = find(autoScalingGroups, (group) => {
    return group.AutoScalingGroupName.match(new RegExp(stackName, 'g'));
  });
  return asg.AutoScalingGroupName;
};

const waitPeriod = 30000;
async function getNewScalingActivity() {
  const params = {
    AutoScalingGroupName: autoScalingGroupName,
    MaxRecords: 1
  };
  let activties = await autoscaling().describeScalingActivities(params).promise();
  const startingActivity = activties.Activities[0];
  let mostRecentActivity = Object.assign({}, startingActivity);
  while (startingActivity.ActivityId === mostRecentActivity.ActivityId) {
    activties = await autoscaling().describeScalingActivities(params).promise();
    mostRecentActivity = activties.Activities[0];
    console.log(`No new activity found. Sleeping for ${waitPeriod/1000} seconds.`);
    await sleep(waitPeriod);
  };

  return mostRecentActivity;
};

const numExecutions = 3;
const numActivityTasks = 1;
const minInstancesCount = 1;

describe('When a task is configured to run in Docker', () => {
  beforeAll(async () => {
    clusterArn = await getClusterArn(config.stackName);
    autoScalingGroupName = await getAutoScalingGroupName(config.stackName);
  });

  describe('the load on the system exceeds that which its resources can handle', () => {
    let workflowExecutionArns = [];

    beforeAll(async () => {
      let workflowExecutionPromises = [];
      for (let i = 0; i < numExecutions; i++) {
        workflowExecutionPromises.push(buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          workflowName
        ));
      };
      workflowExecutionArns = await Promise.all(workflowExecutionPromises);
    });

    afterAll(async () => {
      const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
      await Promise.all(completions);
    });

    it('can handle the load', async () => {
      await sleep(5000);
      const stats = await getClusterStats({});
      expect(stats.runningEC2TasksCount + stats.pendingEC2TasksCount).toEqual(numExecutions + numActivityTasks);
    });

    it('adds new resources', async () => {
      console.log('Waiting for scale out policy to take affect');
      const mostRecentActivity = await getNewScalingActivity();
      expect(mostRecentActivity.Description).toMatch(/Launching a new EC2 instance: i-*/);
    });
  });

  describe('the load on the system is far below what its resources can handle', () => {
    it('removes excessive resources but not all resources', async () => {
      console.log('Waiting for scale in policy to take affect');
      const mostRecentActivity = await getNewScalingActivity();
      expect(mostRecentActivity.Description).toMatch(/Terminating EC2 instance: i-*/);
    });
  });
});
