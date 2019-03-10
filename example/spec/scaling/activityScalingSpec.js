'use strict';

const find = require('lodash.find');

const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterArn,
  getClusterStats
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');
const { loadConfig, loadCloudformationTemplate } = require('../helpers/testUtils');
const config = loadConfig();

let cloudformationResources;
let numExecutions = 2;
let activitiesWaitingAlarm;
const workflowName = 'EcsHelloWorldWorkflow';

describe('scaling for step function activities', () => {
  beforeAll(async() => {
    cloudformationResources = (await loadCloudformationTemplate(config)).Resources;
    activitiesWaitingAlarm = cloudformationResources.ActivitiesWaitingAlarm;
  });

  it('cloudformation stack has an alarm for ActivitiesWaiting', () => {
    expect(activitiesWaitingAlarm).not.toEqual(undefined);
  });

  it('HelloWorld ECS Service is a scalable target', () => {
    const helloWorldScalableTarget = cloudformationResources.HelloWorldServiceECSServiceScalableTarget;
    expect(helloWorldScalableTarget).not.toEqual(undefined);
  });

  it('ActivitiesWaitingAlarm is configured to scale the ECSService', () => {
    const alarmAction = activitiesWaitingAlarm.Properties.AlarmActions[0].Ref;
    expect(alarmAction).toEqual('HelloWorldServiceECSServiceApplicationScalingPolicy');
  });

  describe('scaling activities', () => {
    let workflowExecutionArns = [];
    let alarmPeriodSeconds;
    let sleepMs;

    beforeAll(async () => {
      const workflowExecutionPromises = [];
      const alarmEvaluationPeriods = activitiesWaitingAlarm.Properties.EvaluationPeriods;
      const alarmPeriod = activitiesWaitingAlarm.Properties.Metrics[1].MetricStat.Period;
      const alarmPeriodSeconds = alarmPeriod / alarmEvaluationPeriods;
      const sleepMs = 2 * alarmPeriodSeconds * 1000;

      for (let i = 0; i < numExecutions; i += 1) {
        workflowExecutionPromises.push(buildAndStartWorkflow(
          config.stackName,
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
      it('the number of tasks the service is running should increase', async() => {
        await sleep(alarmPeriodSeconds * 1000 + 10);
        const clusterStats = await getClusterStats(config.stackName);
        const runningEC2TasksCount = find(clusterStats, ['name', 'runningEC2TasksCount']).value;
        expect(runningEC2TasksCount).toBe('2');
      });      
    });

    describe('when activities waiting are below the threshold', () => {
      it('the number of tasks the service is running should decrease', async() => {
        const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
        await Promise.all(completions);
        const clusterStats = await getClusterStats(config.stackName);
        const runningEC2TasksCount = find(clusterStats, ['name', 'runningEC2TasksCount']).value;
        expect(runningEC2TasksCount).toBe('1');
      });
    });
  });
});
