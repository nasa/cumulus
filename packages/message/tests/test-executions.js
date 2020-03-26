'use strict';

const test = require('ava');

const {
  getMessageExecutionArn,
  getMessageExecutionName,
  getMessageStateMachineArn
} = require('../executions');

test('getMessageExecutionName throws error if cumulus_meta.execution_name is missing', (t) => {
  t.throws(
    () => getMessageExecutionName(),
    { message: 'cumulus_meta.execution_name not set in message' }
  );
});

test('getMessageStateMachineArn throws error if cumulus_meta.state_machine is missing', (t) => {
  t.throws(
    () => getMessageStateMachineArn(),
    { message: 'cumulus_meta.state_machine not set in message' }
  );
});

test('getMessageExecutionArn returns correct execution ARN for valid message', (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name'
    }
  };

  const executionArn = getMessageExecutionArn(cumulusMessage);

  t.is(
    executionArn,
    'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name'
  );
});

test('getMessageExecutionArn returns null for an invalid message', (t) => {
  const executionArn = getMessageExecutionArn({});
  t.is(executionArn, null);
});
