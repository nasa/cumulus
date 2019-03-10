'use strict';

const find = require('lodash.find');

const { autoscaling, ecs } = require('@cumulus/common/aws');
const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterArn,
  getClusterStats
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');
const { loadConfig, loadCloudformationTemplate } = require('../helpers/testUtils');

const workflowName = 'HelloWorldOnDemandWorkflow';
const config = loadConfig();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000000;
let clusterArn;
let autoScalingGroupName;

async function getAutoScalingGroupName(stackName) {
  const autoScalingGroups = (await autoscaling().describeAutoScalingGroups({}).promise()).AutoScalingGroups;
  const asg = find(autoScalingGroups, (group) => group.AutoScalingGroupName.match(new RegExp(stackName, 'g')));
  return asg.AutoScalingGroupName;
}

const waitPeriod = 30000;
async function getNewScalingActivity() {
  const params = {
    AutoScalingGroupName: autoScalingGroupName,
    MaxRecords: 1
  };
  let activities = await autoscaling().describeScalingActivities(params).promise();
  const startingActivity = activities.Activities[0];
  let mostRecentActivity = Object.assign({}, startingActivity);
  /* eslint-disable no-await-in-loop */
  while (startingActivity.ActivityId === mostRecentActivity.ActivityId) {
    activities = await autoscaling().describeScalingActivities(params).promise();
    mostRecentActivity = activities.Activities[0];
    console.log(`No new activity found. Sleeping for ${waitPeriod / 1000} seconds.`);
    await sleep(waitPeriod);
  }
  /* eslint-enable no-await-in-loop */

  return mostRecentActivity;
}

const numExecutions = 2;
let cloudformationResources;
let numActivityTasks;
let minInstancesCount;

describe('When a task is configured to run in ECS', () => {
  beforeAll(async () => {
    clusterArn = await getClusterArn(config.stackName);
    autoScalingGroupName = await getAutoScalingGroupName(config.stackName);
    const cloudformationTemplate = await loadCloudformationTemplate(config);
    cloudformationResources = cloudformationTemplate.Resources;
    numActivityTasks = Object.values(cloudformationResources).filter((resource) => resource.Type === 'AWS::StepFunctions::Activity').length;
    minInstancesCount = cloudformationResources.CumulusECSAutoScalingGroup.UpdatePolicy.AutoScalingRollingUpdate.MinInstancesInService;
  });

  describe('the load on the system exceeds that which its resources can handle', () => {
    let workflowExecutionArns = [];

    beforeAll(async () => {
      const workflowExecutionPromises = [];
      for (let i = 0; i < numExecutions; i += 1) {
        workflowExecutionPromises.push(buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          workflowName
        ));
      }
      workflowExecutionArns = await Promise.all(workflowExecutionPromises);
    });

    afterAll(async () => {
      const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
      await Promise.all(completions);
    });

    it('can handle the load (has the expected number of running tasks)', async () => {
      sleep(5000);
      const stats = await getClusterStats(config.stackName);
      console.log(`stats are ${JSON.stringify(stats, null, 2)}\n`);
      console.log(`numExecutions ${numExecutions}\n`);
      console.log(`numActivityTasks ${numActivityTasks}\n`);
      const runningEC2TasksCount = parseInt(find(stats, ['name', 'runningEC2TasksCount']).value);
      const pendingEC2TasksCount = parseInt(find(stats, ['name', 'pendingEC2TasksCount']).value);
      expect(runningEC2TasksCount + pendingEC2TasksCount).toEqual(numExecutions + numActivityTasks);
    });

    it('adds new resources', async () => {
      console.log('Waiting for scale out policy to take affect.');
      const mostRecentActivity = await getNewScalingActivity();
      expect(mostRecentActivity.Description).toMatch(/Launching a new EC2 instance: i-*/);
    });
  });

  describe('the load on the system is far below what its resources can handle', () => {
    it('removes excess resources', async () => {
      console.log('Waiting for scale in policy to take affect.');
      const mostRecentActivity = await getNewScalingActivity();
      expect(mostRecentActivity.Description).toMatch(/Terminating EC2 instance: i-*/);
      const stats = await getClusterStats(config.stackName);
      const runningEC2TasksCount = parseInt(find(stats, ['name', 'runningEC2TasksCount']).value);
      const pendingEC2TasksCount = parseInt(find(stats, ['name', 'pendingEC2TasksCount']).value);
      expect(runningEC2TasksCount + pendingEC2TasksCount).toEqual(numActivityTasks);
    });

    it('does not remove all resources', async () => {
      const instances = await ecs().listContainerInstances({ cluster: clusterArn }).promise();
      console.log(`instances : ${JSON.stringify(instances, 2)}`);
      expect(instances.containerInstanceArns.length).toEqual(minInstancesCount);
    });
  });
});
