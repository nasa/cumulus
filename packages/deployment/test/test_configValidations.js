/* eslint-disable no-template-curly-in-string */

'use strict';

const test = require('ava');
const {
  validateWorkflowDefinedLambdas,
  validatePriorityQueueConfig,
  validatePriorityLevelConfig
} = require('../lib/configValidators');

test.beforeEach((t) => {
  t.context.config = {};
  t.context.config.lambdas = { TestLambda1: {}, TestLambda2: {} };
  t.context.config.stepFunctions = {
    SomeStepFunction: {
      States: {
        TestState: {
          Type: 'Task',
          Resource: '${TestLambda1LambdaFunction.Arn}'
        },
        TestNonLambdaTaskState: {
          Type: 'Task',
          Resource: '${NonLambdaResource}'
        },
        NonTaskState: {
          Type: 'Choice'
        }
      }
    }
  };
});

test('validateWorkflowDefinedLambdas throws an exception when lambda is undefined', async (t) => {
  const config = t.context.config;
  config.stepFunctions.SomeStepFunction.States.TestState.Resource = '${UndefinedLambdaFunction.Arn}';
  await t.throws(() => validateWorkflowDefinedLambdas(config));
});

test('validateWorkflowDefinedLambdas does not throw an exception when configuration is correct', async (t) => {
  await t.notThrows(() => validateWorkflowDefinedLambdas(t.context.config));
});

test('validatePriorityQueueConfig throws an exception when no priority config is defined for SQS priority level', async (t) => {
  const config = t.context.config;
  config.sqs = {
    testQueue: {
      priority: 'test'
    }
  };
  const error = await t.throws(() => validatePriorityQueueConfig(config));
  t.is(error.message, 'Config for testQueue references undefined priority test');
});

test('validatePriorityQueueConfig does not throw an exception when priority config is defined for SQS priority level', async (t) => {
  const config = t.context.config;
  config.sqs = {
    testQueue: {
      priority: 'test'
    }
  };
  config.priority = {
    test: {
      maxExecutions: 5
    }
  };
  await t.notThrows(() => validatePriorityQueueConfig(config));
});

test('validatePriorityLevelConfig throws an exception when priority config is missing maxExecutions', async (t) => {
  const config = t.context.config;
  config.priority = {
    test: {}
  };
  const error = await t.throws(() => validatePriorityLevelConfig(config));
  t.is(error.message, 'Priority configuration for test must include a maxExecutions value');
});

test('validatePriorityLevelConfig does not throw an exception when priority config is correct', async (t) => {
  const config = t.context.config;
  config.priority = {
    test: {
      maxExecutions: 5
    }
  };
  await t.notThrows(() => validatePriorityLevelConfig(config));
});
