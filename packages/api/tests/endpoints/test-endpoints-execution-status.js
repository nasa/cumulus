'use strict';

const rewire = require('rewire');
const test = require('ava');

const executionStatusEndpoint = rewire('../../endpoints/execution-status');
const { testEndpoint } = require('../../lib/testUtils');

const executionStatusCommon = {
  executionArn: 'arn:aws:states:us-east-1:xxx:execution:discoverGranulesStateMachine:3ea094d8',
  stateMachineArn: 'arn:aws:states:us-east-1:xxx:stateMachine:discoverGranulesStateMachine:3ea094d8',
  name: '3ea094d8',
  status: 'SUCCEEDED',
  startDate: 'date',
  stopDate: 'date'
};

const cumulusMetaOutput = {
  cumulus_meta: {
    state_machine: 'arn:aws:states:us-east-1:xxx:stateMachine:discoverGranulesStateMachine',
    message_source: 'sfn',
    workflow_start_time: 1536279498569,
    execution_name: '3ea094d8',
    system_bucket: 'cumulus-map-internal'
  }
};

const remoteMessageOutput = {
  ...cumulusMetaOutput,
  replace: {
    Bucket: 'cumulus-map-internal',
    Key: 'events/df37ded5'
  }
};

const fullMessageOutput = {
  ...cumulusMetaOutput,
  meta: {},
  payload: {},
  exception: 'None',
  workflow_config: {}
};

const stepFunctionMock = {
  getExecutionStatus: function (arn) {
    return new Promise((resolve) => {
      let executionStatus;
      if (arn === 'stillRunning') {
        executionStatus = { ...executionStatusCommon };
      }
      else {
        executionStatus = {
          ...executionStatusCommon,
          output: arn === 'hasFullMessage' ? JSON.stringify(fullMessageOutput) : JSON.stringify(remoteMessageOutput)
        };
      }
      resolve({
        execution: executionStatus,
        executionHistory: {},
        stateMachine: {}
      });
    });
  }
};

const s3Mock = {
  get: function () {
    return new Promise((resolve) => {
      const s3Result = {
        Body: Buffer.from(JSON.stringify(fullMessageOutput))
      };
      resolve(s3Result);
    });
  }
};

executionStatusEndpoint.__set__('StepFunction', stepFunctionMock);
executionStatusEndpoint.__set__('S3', s3Mock);

test('returns execution status', (t) => {
  const event = { pathParameters: { arn: 'hasFullMessage' } };
  return testEndpoint(executionStatusEndpoint, event, (response) => {
    const executionStatus = JSON.parse(response.body);
    t.deepEqual(JSON.stringify(fullMessageOutput), executionStatus.execution.output);
  });
});

test('fetches message from S3 when remote message', (t) => {
  const event = { pathParameters: { arn: 'hasRemoteMessage' } };
  return testEndpoint(executionStatusEndpoint, event, (response) => {
    const executionStatus = JSON.parse(response.body);
    t.deepEqual(JSON.stringify(fullMessageOutput), executionStatus.execution.output);
  });
});

test('when execution is still running, still returns status', (t) => {
  const event = { pathParameters: { arn: 'stillRunning' } };
  return testEndpoint(executionStatusEndpoint, event, (response) => {
    const executionStatus = JSON.parse(response.body);
    const expectedResponse = {
      execution: executionStatusCommon,
      executionHistory: {},
      stateMachine: {}
    };
    t.deepEqual(expectedResponse, executionStatus);
  });
});

