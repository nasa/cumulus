'use strict';

const rewire = require('rewire');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');
const assertions = require('../../lib/assertions');
const executionStatusEndpoint = rewire('../../endpoints/execution-status');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');

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

const replaceObject = (lambdaEvent = true) => ({
  replace: {
    Bucket: 'test-sandbox-internal',
    Key: lambdaEvent ? 'events/lambdaEventUUID' : 'events/executionEventUUID'
  }
});

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
  getExecutionStatus: (arn) =>
    new Promise((resolve) => {
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
    })
};

const s3Mock = {
  get: (_, key) =>
    new Promise((resolve) => {
      const fullMessage = key === 'events/lambdaEventUUID' ? lambdaCompleteOutput : fullMessageOutput;
      const s3Result = {
        Body: Buffer.from(JSON.stringify(fullMessage))
      };
      resolve(s3Result);
    })
};

executionStatusEndpoint.__set__('StepFunction', stepFunctionMock);
executionStatusEndpoint.__set__('S3', s3Mock);

let authHeaders;
let userModel;
test.before(async () => {
  process.env.UsersTable = randomString();

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };
});

test.after.always(async () => {
  await userModel.deleteTable();
});

test('CUMULUS-911 GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      arn: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(executionStatusEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      arn: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(executionStatusEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('returns ARNs for execution and state machine', (t) => {
  const event = {
    pathParameters: {
      arn: 'hasFullMessage'
    },
    headers: authHeaders
  };

  return testEndpoint(executionStatusEndpoint, event, (response) => {
    const executionStatus = JSON.parse(response.body);
    t.is(executionStatusCommon.stateMachineArn, executionStatus.execution.stateMachineArn);
    t.is(executionStatusCommon.executionArn, executionStatus.execution.executionArn);
  });
})

test('returns full message when it is already included in the output', (t) => {
  const event = {
    pathParameters: {
      arn: 'hasFullMessage'
    },
    headers: authHeaders
  };

  return testEndpoint(executionStatusEndpoint, event, (response) => {
    const executionStatus = JSON.parse(response.body);
    t.deepEqual(fullMessageOutput, executionStatus.execution.output);
  });
});

test('fetches messages from S3 when remote message (for both SF execution history and executions)', (t) => {
  const event = {
    pathParameters: {
      arn: 'hasRemoteMessage'
    },
    headers: authHeaders
  };

  return testEndpoint(executionStatusEndpoint, event, (response) => {
    const executionStatus = JSON.parse(response.body);
    const expectedResponse = {
      execution: {
        ...executionStatusCommon,
        output: JSON.stringify(fullMessageOutput)
      },
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

test('when execution is still running, still returns status and fetches SF execution history events from S3', (t) => {
  const event = {
    pathParameters: {
      arn: 'stillRunning'
    },
    headers: authHeaders
  };
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
