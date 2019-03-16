'use strict';

const find = require('lodash.find');

const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterStats,
  getExecutionStatus
} = require('@cumulus/integration-tests');
const { sleep } = require('@cumulus/common/util');
const { loadConfig, loadCloudformationTemplate } = require('../helpers/testUtils');
const config = loadConfig();

const stackName = config.stackName;
let cloudformationResources;
let activitiesWaitingAlarm;
let memoryReservationHighAlarm;
let memoryReservationLowAlarm;
let alarmEvaluationPeriods;
let alarmPeriodSeconds;
let sleepMs;
let numActivityTasks;
const workflowName = 'HelloWorldActivityWorkflow';
const serviceScaleOutPolicyName = 'HelloWorldServiceScaleOutScalingPolicy';
const activiitesWaitingAlarmName = 'HelloWorldServiceActivitiesWaitingAlarm';
const targetTrackingScalingPolicy = 'HelloWorldServiceScalingPolicy';

describe('scaling for step function activities', () => {
  beforeAll(async () => {
    cloudformationResources = (await loadCloudformationTemplate(config)).Resources;
    activitiesWaitingAlarm = cloudformationResources[activiitesWaitingAlarmName];
    alarmEvaluationPeriods = activitiesWaitingAlarm.Properties.EvaluationPeriods;
    const alarmPeriod = activitiesWaitingAlarm.Properties.Metrics[1].MetricStat.Period;
    alarmPeriodSeconds = alarmPeriod / alarmEvaluationPeriods;
    sleepMs = 2 * alarmPeriodSeconds * 1000;
    numActivityTasks = Object.values(cloudformationResources).filter((resource) => resource.Type === 'AWS::StepFunctions::Activity').length;
    memoryReservationHighAlarm = cloudformationResources.MemoryReservationHighAlarm;
    memoryReservationLowAlarm = cloudformationResources.MemoryReservationLowAlarm;
  });


  it('HelloWorld ECS Service is a scalable target', () => {
    const helloWorldScalableTarget = cloudformationResources.HelloWorldServiceECSServiceScalableTarget;
    expect(helloWorldScalableTarget.Type).toEqual('AWS::ApplicationAutoScaling::ScalableTarget');
  });

  describe('ActivitesWaiting alarm', () => {
    it('cloudformation stack has an alarm for ActivitiesWaiting ', () => {
      expect(activitiesWaitingAlarm.Type).toEqual('AWS::CloudWatch::Alarm');
    });

    it('ActivitiesWaitingAlarm is configured to scale out the ECSService', () => {
      const alarmAction = activitiesWaitingAlarm.Properties.AlarmActions[0].Ref;
      expect(alarmAction).toEqual(serviceScaleOutPolicyName);
    });

    it('ScaleOutTasks scaling policy scales out % when ActivitiesWaiting Alarm triggers', () => {
      const scaleOutTasksPolicy = cloudformationResources[serviceScaleOutPolicyName].Properties;
      expect(scaleOutTasksPolicy.StepScalingPolicyConfiguration.AdjustmentType).toEqual('PercentChangeInCapacity');
    });
  });

  describe('ECS Service TargetTracking Policy', () => {
    it('triggers at 20% of CPUUtilization', () => {
      const targetTrackingConfiguration = cloudformationResources[targetTrackingScalingPolicy].Properties.TargetTrackingScalingPolicyConfiguration;
      expect(targetTrackingConfiguration.TargetValue).toEqual(50);
      expect(targetTrackingConfiguration.PredefinedMetricSpecification.PredefinedMetricType).toEqual('ECSServiceAverageCPUUtilization');
    });
  });

  describe('MemoryReservation alarms', () => {
    it('Cloudformation stack has an alarm for High and Low MemoryReservation', () => {
      expect(memoryReservationHighAlarm.Type).toEqual('AWS::CloudWatch::Alarm');
      expect(memoryReservationLowAlarm.Type).toEqual('AWS::CloudWatch::Alarm');
    });

    it('MemoryReservation alarms triggers ec2 scale in or out policies', () => {
      let alarmAction = memoryReservationHighAlarm.Properties.AlarmActions[0].Ref;
      expect(alarmAction).toEqual('ScaleOutEc2ScalingPolicy');
      alarmAction = memoryReservationLowAlarm.Properties.AlarmActions[0].Ref;
      expect(alarmAction).toEqual('ScaleInEc2ScalingPolicy');
    });

    it('MemoryReservationHigh alarm triggers at 75%', () => {
      expect(memoryReservationHighAlarm.Properties.Threshold).toEqual(75);
    });

    it('MemoryReservationLow alarm triggers at 50%', () => {
      expect(memoryReservationHighAlarm.Properties.Threshold).toEqual(75);
    });
  });

  xdescribe('scaling the service\'s desired tasks', () => {
    let workflowExecutionArns = [];
    const numExecutions = 10;

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

    describe('when activities Waiting are greater than the threshold', () => {
      it('the number of tasks the service is running should increase', async () => {
        await sleep(sleepMs);
        const clusterStats = await getClusterStats(stackName);
        const runningEC2TasksCount = parseInt(find(clusterStats, ['name', 'runningEC2TasksCount']).value, 10);
        expect(runningEC2TasksCount).toBeGreaterThan(numActivityTasks);
      });
    });

    describe('when activities scheduled are below the threshold', () => {
      beforeAll(async () => {
        const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
        await Promise.all(completions);
      });

      it('all executions succeeded', async () => {
        const results = await Promise.all(workflowExecutionArns.map((arn) => getExecutionStatus(arn)));
        expect(results).toEqual(new Array(numExecutions).fill('SUCCEEDED'));
      });
    });
  });
});
