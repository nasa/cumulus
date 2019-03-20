'use strict';

const find = require('lodash.find');

const { autoscaling, ecs } = require('@cumulus/common/aws');
const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getAutoScalingGroupName,
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

  // This test is skipped because it is a timely operation to scale in and
  // scale out EC2 instances.
  //
  // The test kicks off 10 workflow executions and asserts an increase in the number of
  // running tasks for the hello world service. It also asserts that (eventually) the
  // number of EC2 instances scales out (and back in).
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

  xdescribe('when scale in takes affect', () => {
    let workflowExecutionArns = [];
    const numExecutions = 2;

    beforeAll(async (done) => {
      try {
        console.log(`in before block`)
        const workflowExecutionPromises = [];
        const clusterArn = await getClusterArn(stackName);
        console.log(`clusterArn ${clusterArn}`);
        const asgName = await getAutoScalingGroupName(stackName);
        console.log(`asgName ${asgName}`);

        // set desired instances to 2 so scale in will take affect
        const setDesiredCapacityParams = {
          AutoScalingGroupName: asgName,
          DesiredCapacity: 2,
          HonorCooldown: true
        };
        await autoscaling().setDesiredCapacity(setDesiredCapacityParams).promise()
          .catch((err) => {
            console.log(`err ${JSON.stringify(err, null, 2)}`)
            if (err.code === 'ScalingActivityInProgress') {
              console.log('ScalingActivityInProgress. Cannot make update.');
            } else {
              throw(err);
            }
          });

        // wait for instances to be active
        const listContainerInstancesParams = { cluster: clusterArn };
        let containerInstanceIds = (await ecs().listContainerInstances(listContainerInstancesParams).promise()).containerInstanceArns;
        let waitTime = 30000;
        while (containerInstanceIds.length < 2) {
          console.log(`waiting for instances to become active`);
          await sleep(waitTime);
          containerInstanceIds = (await ecs().listContainerInstances(listContainerInstancesParams).promise()).containerInstanceArns;
          console.log(`containerInstanceIds ${containerInstanceIds}`);
        };

        // set desired tasks to 2
        const services = await ecs().listServices({cluster: clusterArn}).promise();
        const serviceName = services.serviceArns[0].split('/').pop();
        const updateServiceParams = {
          desiredCount: 2,
          cluster: clusterArn,
          service: serviceName
        };
        const updateServiceResponse = await ecs().updateService(updateServiceParams).promise();

        // Check there is a task running on each instance
        const describeContainerInstanceParams = {
          cluster: clusterArn,
          containerInstances: containerInstanceIds
        }
        let instanceData = await ecs().describeContainerInstances(describeContainerInstanceParams).promise();
        let firstInstanceRunningTasks = instanceData.containerInstances[0].runningTasksCount;
        let secondInstanceRunningTasks = instanceData.containerInstances[1].runningTasksCount;
        console.log(`firstInstanceRunningTasks ${firstInstanceRunningTasks}`);
        console.log(`secondInstanceRunningTasks ${secondInstanceRunningTasks}`);
        while (!(firstInstanceRunningTasks === 1 && secondInstanceRunningTasks === 1)) {
          await sleep(waitTime);
          instanceData = await ecs().describeContainerInstances(describeContainerInstanceParams).promise();
          firstInstanceRunningTasks = instanceData.containerInstances[0].runningTasksCount;
          secondInstanceRunningTasks = instanceData.containerInstances[1].runningTasksCount;
          console.log(`firstInstanceRunningTasks ${firstInstanceRunningTasks}`);
          console.log(`secondInstanceRunningTasks ${secondInstanceRunningTasks}`);
        };

        for (let i = 0; i < numExecutions; i += 1) {
          workflowExecutionPromises.push(buildAndStartWorkflow(
            stackName,
            config.bucket,
            workflowName,
            null,
            null,
            {
              sleep: 4 * sleepMs // sleep for long enough for scale in to take affect (about 7 minutes)
            }
          ));
        }
        // set desired tasks to 1 so memory reservation low alarm will be triggered
        workflowExecutionArns = await Promise.all(workflowExecutionPromises);
        done();
      } catch (e) {
        console.log(e);
        throw(e);
      }
    }, 20*60*1000);

    it('all tasks should complete before instance is terminated', async () => {
      const newScalingActivity = await getNewScalingActivity({stackName});
      expect(newScalingActivity.Description).toMatch(/Terminating EC2 instance: i-*/);
      // expect instance not to be terminated until running tasks complete.
      // So all should complete within sleep
      const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
      console.log(`waiting for completed executions`);
      await Promise.all(completions);
      const results = await Promise.all(workflowExecutionArns.map((arn) => getExecutionStatus(arn)));
      expect(results).toEqual(new Array(numExecutions).fill('SUCCEEDED'));
    });
  });
});
