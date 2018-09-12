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
    system_bucket: 'test-sandbox-internal'
  }
};

const replaceObject = function (lambdaEvent = true) {
  return {
    replace: {
      Bucket: 'test-sandbox-internal',
      Key: lambdaEvent ? 'events/lambdaEventUUID' : 'events/executionEventUUID'
    }
  };
};

const remoteExecutionOutput = {
  ...cumulusMetaOutput,
  ...replaceObject(false)
};

const fullMessageOutput = {
  ...cumulusMetaOutput,
  meta: {},
  payload: {},
  exception: 'None',
  workflow_config: {}
};

const lambdaCommonOutput = {
  cumulus_meta: {
    message_source: 'sfn',
    process: 'modis',
    execution_name: 'bae909c1',
    state_machine: 'arn:aws:states:us-east-1:xxx:stateMachine:testIngestGranuleStateMachine-222',
    workflow_start_time: 111,
    system_bucket: 'test-sandbox-internal'
  },
  meta: {
    sync_granule_duration: 2872,
    sync_granule_end_time: 1536
  }
};

const lambdaRemoteOutput = {
  ...replaceObject(),
  ...lambdaCommonOutput
};

const lambdaCompleteOutput = {
  ...lambdaCommonOutput,
  payload: {
    message: 'Big message'
  },
  exception: 'None'
};

const lambdaEventOutput = {
  type: 'TaskStateExited',
  id: 13,
  previousEventId: 12,
  name: 'SyncGranuleNoVpc',
  output: JSON.stringify(lambdaCompleteOutput)
};

const lambdaFunctionEvent = {
  type: 'TaskStateExited',
  id: 13,
  previousEventId: 12,
  stateExitedEventDetails: {
    name: 'SyncGranuleNoVpc',
    output: JSON.stringify(lambdaRemoteOutput)
  }
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
          output: arn === 'hasFullMessage' ? JSON.stringify(fullMessageOutput) : JSON.stringify(remoteExecutionOutput)
        };
      }
      resolve({
        execution: executionStatus,
        executionHistory: {
          events: [
            lambdaFunctionEvent
          ]
        },
        stateMachine: {}
      });
    });
  }
};

const s3Mock = {
  get: function (_, key) {
    return new Promise((resolve) => {
      const fullMessage = key === 'events/lambdaEventUUID' ? lambdaCompleteOutput : fullMessageOutput;
      const s3Result = {
        Body: Buffer.from(JSON.stringify(fullMessage))
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
    t.deepEqual(fullMessageOutput, executionStatus.execution.output);
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
      executionHistory: {
        events: [
          lambdaEventOutput
        ]
      },
      stateMachine: {}
    };
    t.deepEqual(expectedResponse, executionStatus);
  });
});

