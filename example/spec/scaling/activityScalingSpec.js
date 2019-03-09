'use strict';

const find = require('lodash.find');

const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  getClusterArn
} = require('@cumulus/integration-tests');
const { loadConfig, loadCloudformationTemplate } = require('../helpers/testUtils');
const config = loadConfig();

let cloudformationResources;
let numExecutions = 2;
const workflowName = 'EcsHelloWorldWorkflow';

describe('scaling for step function activities', () => {
  beforeAll(async() => {
    cloudformationResources = (await loadCloudformationTemplate(config)).Resources;
  });

  it('cloudformation stack has an alarm for ActivitiesWaiting', () => {
    const activitiesWaitingAlarm = cloudformationResources.ActivitiesWaitingAlarm;
    expect(activitiesWaitingAlarm).not.toEqual(undefined);
  });

  it('HelloWorld ECS Service is a scalable target', () => {
    const helloWorldScalableTarget = cloudformationResources.HelloWorldServiceECSServiceScalableTarget;
    expect(helloWorldScalableTarget).not.toEqual(undefined);
  });

  it('ActivitiesWaitingAlarm is configured to scale the ECSService', () => {
    const activitiesWaitingAlarm = cloudformationResources.ActivitiesWaitingAlarm;
    const alarmAction = activitiesWaitingAlarm.Properties.AlarmActions[0].Ref;
    expect(alarmAction).toEqual('HelloWorldServiceECSServiceApplicationScalingPolicy');
  });

  describe('when activities waiting are greater than 0 for 1 minute', () => {
    let workflowExecutionArns = [];

    beforeAll(async () => {
      const workflowExecutionPromises = [];
      for (let i = 0; i < numExecutions; i += 1) {
        workflowExecutionPromises.push(buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          workflowName,
          null,
          null,
          {
            sleep: 12000 // sleep for 2 minutes for task scaling to take affect.
          }
        ));
      }
      workflowExecutionArns = await Promise.all(workflowExecutionPromises);
    });

    afterAll(async () => {
      const completions = workflowExecutionArns.map((executionArn) => waitForCompletedExecution(executionArn));
      await Promise.all(completions);
    });

    it('the number of tasks the service is running should increase by 1', () => {
      expect('something').toBe(true);
    });
  });

  // describe('when the number of activities waiting is 0 for 1 minute', () => {
  //   it('the number of tasks the service is running should decrease by 1')
  // });
});