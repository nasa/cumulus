'use strict';

const find = require('lodash.find');

const { ecs } = require('@cumulus/common/aws');
const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterArn,
  getClusterStats,
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
const workflowName = 'HelloWorldActivityWorkflow';

describe('scaling for step function activities', () => {
  beforeAll(async() => {
    cloudformationResources = (await loadCloudformationTemplate(config)).Resources;
    activitiesWaitingAlarm = cloudformationResources.ActivitiesWaitingAlarm;
    alarmEvaluationPeriods = activitiesWaitingAlarm.Properties.EvaluationPeriods;
    const alarmPeriod = activitiesWaitingAlarm.Properties.Metrics[0].MetricStat.Period;
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

  // describe('scaling the service\'s desired tasks', () => {
  //   let workflowExecutionArns = [];
  //   let alarmPeriodSeconds;
  //   let sleepMs;

  //   beforeAll(async () => {
  //     const workflowExecutionPromises = [];

  //     for (let i = 0; i < numExecutions; i += 1) {
  //       workflowExecutionPromises.push(buildAndStartWorkflow(
  //         stackName,
  //         config.bucket,
  //         workflowName,
  //         null,
  //         null,
  //         {
  //           sleep: sleepMs
  //         }
  //       ));
  //     }
  //     workflowExecutionArns = await Promise.all(workflowExecutionPromises);
  //   });

  //   describe('when activities waiting are greater than the threshold', () => {
  //     it('the number of tasks the service is running should increase', async() => {
  //       await sleep(sleepMs);
  //       const clusterStats = await getClusterStats(stackName);
  //       console.log(`clusterStats ${JSON.stringify(clusterStats, null, 2)}\n`);
  //       const runningEC2TasksCount = find(clusterStats, ['name', 'runningEC2TasksCount']).value;
  //       expect(runningEC2TasksCount).toBe('2');
  //     });
  //   });

  //   describe('when activities waiting are below the threshold', () => {
  //     it('the number of tasks the service is running should decrease', async() => {
  //       const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
  //       await Promise.all(completions);
  //       const clusterStats = await getClusterStats(stackName);
  //       console.log(`clusterStats ${JSON.stringify(clusterStats, null, 2)}\n`);
  //       const runningEC2TasksCount = find(clusterStats, ['name', 'runningEC2TasksCount']).value;
  //       expect(runningEC2TasksCount).toBe('1');
  //     });
  //   });
  // });

  describe('scaling the cluster\'s desired ec2 instances', () => {
    numExecutions = 10;
    let workflowExecutionArns = [];

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

    it('adds new resources', async () => {
      console.log('Waiting for scale out policy to take affect.');
      const mostRecentActivity = await getNewScalingActivity({stackName});
      expect(mostRecentActivity.Description).toMatch(/Launching a new EC2 instance: i-*/);
    });

    describe('the load on the system is far below what its resources can handle', () => {
      it('removes excess resources', async () => {
        console.log('Waiting for scale in policy to take affect.');
        const mostRecentActivity = await getNewScalingActivity({stackName});
        expect(mostRecentActivity.Description).toMatch(/Terminating EC2 instance: i-*/);
        const stats = await getClusterStats(stackName);
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
});
