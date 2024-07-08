const test = require('ava');
const proxyquire = require('proxyquire');

const { randomId } = require('@cumulus/common/test-utils');

const fakeGranule = {
  granuleId: randomId('FakeGranule1'),
  dataType: randomId('FakeGranuleType'),
  version: '000',
  provider: randomId('FakeProvider'),
  createdAt: new Date().getTime(),
  files: [
    {
      bucket: randomId('fakeBucket1'),
      checksumType: 'md5',
      checksum: randomId('fakehash'),
      key: 'path/to/granule1/foo.jpg',
    },
    {
      bucket: randomId('fakeBucket1'),
      checksumType: 'md5',
      checksum: randomId('fakehash'),
      key: '/path/to/granule1/foo.dat',
    },
  ],
};

const fakeConfig = {
  buckets: {
    glacier: {
      name: randomId('glacier-bucket'),
      type: 'orca',
    },
    protected: {
      name: randomId('protected-bucket'),
      type: 'protected',
    },
  },
  fileBucketMaps: [{
    regex: '.*.hdf$',
    bucket: 'protected',
  }],
};

const fakeStartExecutionResponse = {
  executionArn: randomId('executionArn'),
  startDate: new Date(),
};

const fakeInvalidSfnArn = randomId('fakeInvalidSfnArn');
const fakeFailedSfnArn = randomId('fakeFailedSfnArn');
const fakeRunningSfnArn = randomId('fakeRunningSfnArn');
const fakeDescribeExecutionResponse = {
  executionArn: randomId('executionArn'),
  stateMachineArn: randomId('stateMachineArn'),
  name: randomId('name'),
  status: 'SUCCEEDED',
  input: JSON.stringify({ inputKey: randomId('input') }),
  inputDetails: {
    included: true,
  },
  output: JSON.stringify({ outputKey: randomId('output') }),
  outputDetails: {
    included: true,
  },
};

const fakeDescribeFailedExecutionResponse = {
  ...fakeDescribeExecutionResponse,
  status: 'FAILED',
  outputDetails: {
    included: false,
  },
};

const fakeDescribeRunningExecutionResponse = {
  ...fakeDescribeExecutionResponse,
  status: 'RUNNING',
  outputDetails: {
    included: false,
  },
};

const {
  invokeOrcaRecoveryWorkflow,
  getStateMachineExecutionResults,
} = proxyquire('../dist/src', {
  '@cumulus/aws-client/services': {
    sfn: () => ({
      startExecution: ({ stateMachineArn }) => {
        if (stateMachineArn.startsWith(fakeInvalidSfnArn)) {
          throw new Error('sfn execution error');
        }
        return Promise.resolve(fakeStartExecutionResponse);
      },
    }),
  },
  '@cumulus/aws-client/StepFunctions': {
    describeExecution: ({ executionArn }) => {
      if (executionArn.startsWith(fakeRunningSfnArn)) {
        return Promise.resolve(fakeDescribeRunningExecutionResponse);
      }
      if (executionArn.startsWith(fakeFailedSfnArn)) {
        return Promise.resolve(fakeDescribeFailedExecutionResponse);
      }
      return Promise.resolve(fakeDescribeExecutionResponse);
    },
  },
});

const fakePayload = {
  input: {
    granules: [fakeGranule],
  },
  config: fakeConfig,
  cumulus_config: {
    execution_name: randomId('execution_name'),
    state_machine: randomId('state_machine'),
  },
};

test.serial('invokeOrcaRecoveryWorkflow() successfully invokes orca recovery workflow', async (t) => {
  process.env.orca_sfn_recovery_workflow_arn = randomId('recoveryWorkflowArn');
  const result = await invokeOrcaRecoveryWorkflow(fakePayload);
  const expectedResult = {
    granules: fakePayload.input.granules,
    recoveryOutput: JSON.parse(fakeDescribeExecutionResponse.output),
  };
  t.deepEqual(result, expectedResult);
});

test.serial('invokeOrcaRecoveryWorkflow() throws error if it fails to start orca workflow', async (t) => {
  process.env.orca_sfn_recovery_workflow_arn = fakeInvalidSfnArn;
  await t.throwsAsync(
    invokeOrcaRecoveryWorkflow(fakePayload, undefined),
    {
      message: 'sfn execution error',
    }
  );
});

test.serial('invokeOrcaRecoveryWorkflow() throws error if orca recovery workflow fails', async (t) => {
  process.env.orca_sfn_recovery_workflow_arn = fakeFailedSfnArn;
  await t.throwsAsync(
    invokeOrcaRecoveryWorkflow(fakePayload, undefined),
    {
      message: new RegExp(`Error execute ${fakeFailedSfnArn}`),
    }
  );
});

test.serial('getStateMachineExecutionResults() waits for orca recovery workflow to complete', async (t) => {
  process.env.orca_sfn_recovery_workflow_arn = fakeRunningSfnArn;
  const error = await t.throwsAsync(
    getStateMachineExecutionResults({
      executionArn: `${fakeRunningSfnArn}:${randomId()}`,
      retries: 1,
      retryIntervalInSecond: 1,
      maxRetryTimeInSecond: 1,
    })
  );
  t.is(error.attemptNumber, 2);
  t.is(error.retriesLeft, 0);
  t.truthy(error.message.match(/Waiting for recovery workflow.* to complete/));
});

test.serial('invokeOrcaRecoveryWorkflow() throws error if env orca_sfn_recovery_workflow_arn is not set', async (t) => {
  delete process.env.orca_sfn_recovery_workflow_arn;
  await t.throwsAsync(
    invokeOrcaRecoveryWorkflow(fakePayload, undefined),
    {
      message: 'Environment orca_sfn_recovery_workflow_arn is not set',
    }
  );
});
