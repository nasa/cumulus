/* eslint-disable no-template-curly-in-string */
'use strict';

const test = require('ava');
const validateWorkflowDefinedLambdas = require('../lib/configValidators');

test.beforeEach((t) => {
  t.context.config = {}
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
  }
});

test('validateWorkflowDefinedLambdas throws an exception when lambda is undefined', async (t) => {
  const config = t.context.config;
  config.stepFunctions.SomeStepFunction.States.TestState.Resource = '${UndefinedLambdaFunction.Arn}';
  await t.throws(() => validateWorkflowDefinedLambdas(config));
});

test('validateWorkflowDefinedLambdas does not throw an exception when configuration is correct', async (t) => {
  await t.notThrows(() => validateWorkflowDefinedLambdas(t.context.config));
});
