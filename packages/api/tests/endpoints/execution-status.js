'use strict';

const request = require('supertest');
const test = require('ava');
const sinon = require('sinon');
const commonAws = require('@cumulus/common/aws');
const { StepFunction } = require('@cumulus/ingest/aws');
const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');
const assertions = require('../../lib/assertions');
const {
  createFakeJwtAuthToken,
  fakeExecutionFactoryV2
} = require('../../lib/testUtils');

process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();
process.env.ExecutionsTable = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

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

const expiredExecutionArn = 'fakeExpiredExecutionArn';
const fakeExpiredExecution = fakeExecutionFactoryV2({ arn: expiredExecutionArn });

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

const executionExistsMock = (arn) => {
  if (arn.executionArn === expiredExecutionArn) {
    return {
      promise: () => {
        const error = new Error();
        error.code = 'ExecutionDoesNotExist';
        return Promise.reject(error);
      }
    };
  }
  return {
    promise: () => Promise.resolve(true)
  };
};

const s3Mock = (_, key) =>
  new Promise((resolve) => {
    const fullMessage = key === 'events/lambdaEventUUID' ? lambdaCompleteOutput : fullMessageOutput;
    const s3Result = {
      Body: Buffer.from(JSON.stringify(fullMessage))
    };
    resolve(s3Result);
  });

let jwtAuthToken;
let accessTokenModel;
let executionModel;
let userModel;
let mockedS3;
let mockedSF;
let mockedSFExecution;

test.before(async () => {
  mockedS3 = sinon.stub(commonAws, 'getS3Object').callsFake(s3Mock);
  mockedSF = sinon.stub(StepFunction, 'getExecutionStatus').callsFake(stepFunctionMock.getExecutionStatus);
  mockedSFExecution = sinon
    .stub(commonAws.sfn(), 'describeExecution')
    .callsFake(executionExistsMock);

  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
  executionModel = new models.Execution();
  await executionModel.createTable();
  await executionModel.create(fakeExpiredExecution);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
  mockedS3.restore();
  mockedSF.restore();
  mockedSFExecution.restore();
  await executionModel.deleteTable();
});

test('CUMULUS-911 GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions/status/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/executions/status/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET with an unauthorized user returns an unauthorized response');

test('returns ARNs for execution and state machine', async (t) => {
  const response = await request(app)
    .get('/executions/status/hasFullMessage')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionStatus = response.body;
  t.is(executionStatusCommon.stateMachineArn, executionStatus.execution.stateMachineArn);
  t.is(executionStatusCommon.executionArn, executionStatus.execution.executionArn);
});

test('returns full message when it is already included in the output', async (t) => {
  const response = await request(app)
    .get('/executions/status/hasFullMessage')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionStatus = response.body;
  t.deepEqual(fullMessageOutput, JSON.parse(executionStatus.execution.output));
});

test('fetches messages from S3 when remote message (for both SF execution history and executions)', async (t) => {
  const response = await request(app)
    .get('/executions/status/hasRemoteMessage')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionStatus = response.body;
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

test('when execution is still running, still returns status and fetches SF execution history events from S3', async (t) => {
  const response = await request(app)
    .get('/executions/status/stillRunning')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionStatus = response.body;
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

test('when execution is no longer in step function API, returns status from database', async (t) => {
  const response = await request(app)
    .get(`/executions/status/${expiredExecutionArn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionStatus = response.body;
  t.falsy(executionStatus.executionHistory);
  t.falsy(executionStatus.stateMachine);
  t.is(executionStatus.execution.executionArn, fakeExpiredExecution.arn);
  t.is(executionStatus.execution.name, fakeExpiredExecution.name);
  t.is(executionStatus.execution.input, JSON.stringify(fakeExpiredExecution.originalPayload));
  t.is(executionStatus.execution.output, JSON.stringify(fakeExpiredExecution.finalPayload));
});
