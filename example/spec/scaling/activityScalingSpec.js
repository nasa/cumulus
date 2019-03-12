'use strict';

const find = require('lodash.find');

const { ecs } = require('@cumulus/common/aws');
const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterArn,
  getClusterStats,
  getExecutionStatus,
  getNewScalingActivity
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');
const { loadConfig, loadCloudformationTemplate } = require('../helpers/testUtils');
const config = loadConfig();

const stackName = config.stackName;
let cloudformationResources;
let numExecutions = 2;
let activitiesWaitingAlarm;
let alarmEvaluationPeriods;
let alarmPeriodSeconds;
let sleepMs;
let clusterArn;
let numActivityTasks;
let minInstancesCount;
const workflowName = 'HelloWorldActivityWorkflow';

describe('scaling for step function activities', () => {
  beforeAll(async () => {
    cloudformationResources = (await loadCloudformationTemplate(config)).Resources;
    activitiesWaitingAlarm = cloudformationResources.ActivitiesWaitingAlarm;
    alarmEvaluationPeriods = activitiesWaitingAlarm.Properties.EvaluationPeriods;
    const alarmPeriod = activitiesWaitingAlarm.Properties.Metrics[1].MetricStat.Period;
    alarmPeriodSeconds = alarmPeriod / alarmEvaluationPeriods;
    sleepMs = 2 * alarmPeriodSeconds * 1000;
    clusterArn = await getClusterArn(stackName);
    numActivityTasks = Object.values(cloudformationResources).filter((resource) => resource.Type === 'AWS::StepFunctions::Activity').length;
    minInstancesCount = cloudformationResources.CumulusECSAutoScalingGroup.UpdatePolicy.AutoScalingRollingUpdate.MinInstancesInService;
  });

  it('cloudformation stack has an alarm for ActivitiesWaiting ', () => {
    expect(activitiesWaitingAlarm.Type).toEqual('AWS::CloudWatch::Alarm');
  });

  it('HelloWorld ECS Service is a scalable target', () => {
    const helloWorldScalableTarget = cloudformationResources.HelloWorldServiceECSServiceScalableTarget;
    expect(helloWorldScalableTarget.Type).toEqual('AWS::ApplicationAutoScaling::ScalableTarget');
  });

  it('ActivitiesWaitingAlarm is configured to scale the ECSService', () => {
    const alarmAction = activitiesWaitingAlarm.Properties.AlarmActions[0].Ref;
    expect(alarmAction).toEqual('ScaleOutTasksECSServiceApplicationScalingPolicy');
  });

  describe('scaling the service\'s desired tasks', () => {
    let workflowExecutionArns = [];
    numExecutions = 10;

    beforeAll(async () => {
      const workflowExecutionPromises = [];

      for (let i = 0; i < numExecutions; i += 1) {
        workflowExecutionPromises.push(buildAndStartWorkflow(
          stackName,
          config.bucket,
          workflowName,
          null,
          null,
          {
            sleep: sleepMs
          }
        ));
      }
      workflowExecutionArns = await Promise.all(workflowExecutionPromises);
    });

    describe('when activities waiting are greater than the threshold', () => {
      it('the number of tasks the service is running should increase', async () => {
        // wait the period of the alarm plus a bit
        await sleep(alarmPeriodSeconds * 1000 + 30000);
        const clusterStats = await getClusterStats(stackName);
        console.log(`clusterStats ${JSON.stringify(clusterStats, null, 2)}\n`);
        const runningEC2TasksCount = parseInt(find(clusterStats, ['name', 'runningEC2TasksCount']).value, 10);
        expect(runningEC2TasksCount).toBeGreaterThan(numActivityTasks);
      });

      it('adds new ec2 resources', async () => {
        console.log('Waiting for scale out policy to take affect.');
        const mostRecentActivity = await getNewScalingActivity({ stackName });
        expect(mostRecentActivity.Description).toMatch(/Launching a new EC2 instance: i-*/);
      });
    });

    describe('when activities waiting are below the threshold', () => {
      beforeAll(async () => {
        const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
        await Promise.all(completions);
      });

      it('removes excess resources', async () => {
        console.log('Waiting for scale in policy to take affect.');
        const mostRecentActivity = await getNewScalingActivity({ stackName });
        expect(mostRecentActivity.Description).toMatch(/Terminating EC2 instance: i-*/);
        const clusterStats = await getClusterStats(stackName);
        const runningEC2TasksCount = parseInt(find(clusterStats, ['name', 'runningEC2TasksCount']).value, 10);
        const pendingEC2TasksCount = parseInt(find(clusterStats, ['name', 'pendingEC2TasksCount']).value, 10);
        console.log(`clusterStats ${clusterStats} `);
        expect(runningEC2TasksCount + pendingEC2TasksCount).toEqual(numActivityTasks);
      });

      it('the number of tasks the service is running should decrease', async () => {
        const clusterStats = await getClusterStats(stackName);
        console.log(`clusterStats ${JSON.stringify(clusterStats, null, 2)}\n`);
        const runningEC2TasksCount = parseInt(find(clusterStats, ['name', 'runningEC2TasksCount']).value, 10);
        expect(runningEC2TasksCount).toBe(numActivityTasks);
      });

      it('does not remove all resources', async () => {
        const instances = await ecs().listContainerInstances({ cluster: clusterArn }).promise();
        expect(instances.containerInstanceArns.length).toEqual(minInstancesCount);
      });

      it('all executions succeeded', async () => {
        const results = await Promise.all(workflowExecutionArns.map((arn) => getExecutionStatus(arn)));
        expect(results).toEqual(new Array(numExecutions).fill('SUCCEEDED'));
      });
    });
  });
});
