'use strict';

const find = require('lodash.find');

const { autoscaling, ecs } = require('@cumulus/common/aws');
const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterArn
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');
const { loadConfig, loadCloudformationTemplate } = require('../helpers/testUtils');

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
}

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

const numExecutions = 3;
const cloudformationTemplate = loadCloudformationTemplate();
const cloudformationResources = cloudformationTemplate.Resources;
const numActivityTasks = Object.values(cloudformationResources).filter((resource) => resource.Type === 'AWS::StepFunctions::Activity').length;
const minInstancesCount = cloudformationResources.CumulusECSAutoScalingGroup.UpdatePolicy.AutoScalingRollingUpdate.MinInstancesInService;

describe('cloudformation template for scaling policies', () => {
  describe('SimpleScaling Policies', () => {
    const simpleScalingPolicy = {
      Type: 'AWS::AutoScaling::ScalingPolicy',
      Properties: {
        AdjustmentType: 'ChangeInCapacity',
        AutoScalingGroupName: {
          Ref: 'CumulusECSAutoScalingGroup'
        },
        Cooldown: 60,
        PolicyType: 'SimpleScaling'
      }
    };

    it('ScaleOut has the expected values', () => {
      const expectedScaleOutPolicy = Object.assign({}, simpleScalingPolicy);
      expectedScaleOutPolicy.Properties.ScalingAdjustment = 1;
      expect(cloudformationResources.ScaleOutScalingPolicy).toEqual(expectedScaleOutPolicy);
    });

    it('ScaleIn has the expected values', () => {
      const expectedScaleInPolicy = Object.assign({}, simpleScalingPolicy);
      expectedScaleInPolicy.Properties.ScalingAdjustment = -1;
      expect(cloudformationResources.ScaleInScalingPolicy).toEqual(expectedScaleInPolicy);
    });
  });

  describe('StepScaling Policy', () => {
    const expectedStepScalingPolicy = {
      Type: 'AWS::AutoScaling::ScalingPolicy',
      Properties: {
        PolicyType: 'StepScaling',
        AdjustmentType: 'ChangeInCapacity',
        EstimatedInstanceWarmup: 60,
        MetricAggregationType: 'Average',
        AutoScalingGroupName: {
          Ref: 'CumulusECSAutoScalingGroup'
        },
        StepAdjustments: [{
          MetricIntervalLowerBound: 0,
          ScalingAdjustment: 1
        },
        {
          MetricIntervalUpperBound: 0,
          ScalingAdjustment: -1
        }]
      }
    };

    it('has the expected values', () => {
      expect(cloudformationResources.StepScalingPolicy).toEqual(expectedStepScalingPolicy);
    });
  });

  describe('TargetScalingPolicy', () => {
    const expectedTargetScalingPolicy = {
      Type: 'AWS::AutoScaling::ScalingPolicy',
      Properties: {
        PolicyType: 'TargetTrackingScaling',
        AdjustmentType: 'ChangeInCapacity',
        EstimatedInstanceWarmup: 60,
        Cooldown: 60,
        AutoScalingGroupName: {
          Ref: 'CumulusECSAutoScalingGroup'
        },
        TargetTrackingConfiguration: {
          DisableScaleIn: false,
          TargetValue: 50,
          PredefinedMetricSpecification: {
            PredefinedMetricType: 'ASGAverageCPUUtilization'
          }
        }
      }
    };

    it('has the expected values', () => {
      expect(cloudformationResources.TargetScalingPolicy).toEqual(expectedTargetScalingPolicy);
    });
  });
});

describe('When a task is configured to run in ECS', () => {
  beforeAll(async () => {
    clusterArn = await getClusterArn(config.stackName);
    autoScalingGroupName = await getAutoScalingGroupName(config.stackName);
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

    it('can handle the load', async () => {
      await sleep(5000);
      const stats = await getClusterStats({});
      expect(stats.runningEC2TasksCount + stats.pendingEC2TasksCount).toEqual(numExecutions + numActivityTasks);
    });

    it('adds new resources', async () => {
      console.log('Waiting for scale out policy to take affect.');
      const mostRecentActivity = await getNewScalingActivity();
      expect(mostRecentActivity.Description).toMatch(/Launching a new EC2 instance: i-*/);
    });
  });

  describe('the load on the system is far below what its resources can handle', () => {
    it('removes excessive resources but not all resources', async () => {
      console.log('Waiting for scale in policy to take affect.');
      const mostRecentActivity = await getNewScalingActivity();
      expect(mostRecentActivity.Description).toMatch(/Terminating EC2 instance: i-*/);
      const stats = await getClusterStats({});
      expect(stats.runningEC2TasksCount + stats.pendingEC2TasksCount).toEqual(numActivityTasks);
      const instances = await ecs().listContainerInstances({ cluster: clusterArn }).promise();
      expect(instances.containerInstanceArns.length).toEqual(minInstancesCount);
    });
  });
});
