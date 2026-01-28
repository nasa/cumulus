'use strict';

const pRetry = require('p-retry');
const {
  AddPermissionCommand,
  DeleteEventSourceMappingCommand,
  GetFunctionCommand,
  InvokeCommand,
  RemovePermissionCommand,
  CreateEventSourceMappingCommand,
} = require('@aws-sdk/client-lambda');

const { sleep } = require('@cumulus/common');
const {
  lambda,
  sfn,
  sqs,
  dynamodbDocClient,
  cloudwatchevents,
} = require('@cumulus/aws-client/services');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { waitForAllTestSf } = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  timestampedName,
} = require('../../helpers/testUtils');

async function sendStartSfMessages({
  numOfMessages,
  queueMaxExecutions,
  queueUrl,
  workflowArn,
  payload = {},
}) {
  const message = {
    cumulus_meta: {
      state_machine: workflowArn,
    },
    payload,
  };

  if (queueMaxExecutions) {
    message.cumulus_meta.queueExecutionLimits = {
      [queueUrl]: queueMaxExecutions,
    };
  }

  const sendMessages = new Array(numOfMessages)
    .fill()
    .map(
      () =>
        sqs().sendMessage({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) })
    );
  return await Promise.all(sendMessages);
}

const createCloudwatchRuleWithTarget = async ({
  stateMachineArn,
  functionName,
  ruleName,
  ruleTargetId,
  rulePermissionId,
}) => {
  const { RuleArn } = await cloudwatchevents().putRule({
    Name: ruleName,
    State: 'ENABLED',
    EventPattern: JSON.stringify({
      source: [
        'aws.states',
      ],
      'detail-type': [
        'Step Functions Execution Status Change',
      ],
      detail: {
        status: [
          'ABORTED',
          'FAILED',
          'SUCCEEDED',
          'TIMED_OUT',
        ],
        stateMachineArn: [
          stateMachineArn,
        ],
      },
    }),
  });

  const { Configuration } = await lambda().send(new GetFunctionCommand({
    FunctionName: functionName,
  }));

  await cloudwatchevents().putTargets({
    Rule: ruleName,
    Targets: [{
      Id: ruleTargetId,
      Arn: Configuration.FunctionArn,
    }],
  });

  return lambda().send(new AddPermissionCommand({
    Action: 'lambda:InvokeFunction',
    FunctionName: functionName,
    Principal: 'events.amazonaws.com',
    StatementId: rulePermissionId,
    SourceArn: RuleArn,
  }));
};

const deleteCloudwatchRuleWithTargets = async ({
  functionName,
  ruleName,
  rulePermissionId,
  ruleTargetId,
}) => {
  await cloudwatchevents().removeTargets({
    Ids: [
      ruleTargetId,
    ],
    Rule: ruleName,
  });

  await lambda().send(new RemovePermissionCommand({
    FunctionName: functionName,
    StatementId: rulePermissionId,
  }));

  return cloudwatchevents().deleteRule({
    Name: ruleName,
  });
};

describe('the sf-starter lambda function', () => {
  let config;
  let testName;
  let passSfArn;
  let waitPassSfArn;

  beforeAll(async () => {
    config = await loadConfig();

    testName = createTimestampedTestId(config.stackName, 'testStartSf');

    const passSfRoleArn = `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/${config.stackName}-steprole`;

    const passSfName = timestampedName('passTestSf');
    const passSfDef = {
      Comment: 'Pass-only step function',
      StartAt: 'PassState',
      States: {
        PassState: {
          Type: 'Pass',
          ResultPath: '$.payload',
          End: true,
        },
      },
    };
    const passSfParams = {
      name: passSfName,
      definition: JSON.stringify(passSfDef),
      roleArn: passSfRoleArn,
    };
    const { stateMachineArn } = await sfn().createStateMachine(passSfParams);
    passSfArn = stateMachineArn;

    const waitPassSfName = timestampedName('waitPassTestSf');
    const waitPassSfDef = {
      Comment: 'Pass-only step function',
      StartAt: 'WaitState',
      States: {
        WaitState: {
          Type: 'Wait',
          Seconds: 3,
          Next: 'PassState',
        },
        PassState: {
          Type: 'Pass',
          ResultPath: '$.payload',
          End: true,
        },
      },
    };
    const waitPassSfParams = {
      name: waitPassSfName,
      definition: JSON.stringify(waitPassSfDef),
      roleArn: passSfRoleArn,
    };
    const response = await sfn().createStateMachine(waitPassSfParams);
    waitPassSfArn = response.stateMachineArn;
  });

  afterAll(async () => {
    await sfn().deleteStateMachine({ stateMachineArn: passSfArn });
    await sfn().deleteStateMachine({ stateMachineArn: waitPassSfArn });
  });

  describe('when linked to a queue', () => {
    const initialMessageCount = 30;

    let queueName;
    let queueUrl;
    let queueArn;
    let sfStarterName;
    let executionPayload;

    beforeAll(async () => {
      sfStarterName = `${config.stackName}-sqs2sf`;

      queueName = `${testName}Queue`;
      executionPayload = { test: testName };

      const { QueueUrl } = await sqs().createQueue({
        QueueName: queueName,
        Attributes: {
          VisibilityTimeout: '360',
        },
      });
      queueUrl = QueueUrl;

      const { Attributes } = await sqs().getQueueAttributes({
        QueueUrl: queueUrl,
        AttributeNames: ['QueueArn'],
      });
      queueArn = Attributes.QueueArn;

      await sendStartSfMessages({
        numOfMessages: initialMessageCount,
        queueName,
        queueUrl,
        workflowArn: passSfArn,
        payload: executionPayload,
      });
    });

    afterAll(async () => {
      await sqs().deleteQueue({
        QueueUrl: queueUrl,
      });
    });

    it('that has messages', () => {
      pending('until SQS provides a strongly consistent getNumberOfMessages function');
    });

    describe('the messages on the queue', () => {
      let mappingUUID;

      beforeAll(async () => {
        const { UUID } = await lambda().send(new CreateEventSourceMappingCommand({
          EventSourceArn: queueArn,
          FunctionName: sfStarterName,
          Enabled: true,
        }));
        mappingUUID = UUID;
      });

      afterAll(async () => {
        await pRetry(
          async () => {
            try {
              await lambda().send(new DeleteEventSourceMappingCommand({
                UUID: mappingUUID,
              }));
            } catch (error) {
              console.log(`Caught error while deleting eventSourceMapping ${error.code}, ${error.name}, ${error.message}`);
              if (error.name === 'ResourceInUseException') {
                console.log(`Waiting for eventSourceMapping eligible for deletion, get message ${error.message}`);
                throw error;
              } else if (error.name !== 'ResourceNotFoundException') {
                throw new pRetry.AbortError(error);
              }
            }
          },
          { retries: 60, maxTimeout: 5000, factor: 1.05 }
        );
      });

      it('are used to trigger workflows', async () => {
        const executions = await waitForAllTestSf(
          executionPayload,
          passSfArn,
          60 * 2,
          initialMessageCount
        );
        expect(executions.length).toEqual(initialMessageCount);
      });

      it('and then deleted from the queue', () => {
        pending('until SQS provides a strongly consistent getNumberOfMessages function');
      });
    });
  });

  describe('when provided a queue with a maximum number of executions', () => {
    let maxQueueUrl;
    let messagesConsumed;
    let ruleName;
    let rulePermissionId;
    let ruleTargetId;
    let semaphoreDownLambda;

    const queueMaxExecutions = 5;
    const totalNumMessages = 20;

    beforeAll(async () => {
      semaphoreDownLambda = `${config.stackName}-sfSemaphoreDown`;

      const maxQueueName = `${testName}MaxQueue`;

      const { QueueUrl } = await sqs().createQueue({
        QueueName: maxQueueName,
      });
      maxQueueUrl = QueueUrl;

      ruleName = timestampedName('waitPassSfRule');
      ruleTargetId = timestampedName('waitPassSfRuleTarget');
      rulePermissionId = timestampedName('waitPassSfRulePermission');

      await createCloudwatchRuleWithTarget({
        stateMachineArn: waitPassSfArn,
        functionName: semaphoreDownLambda,
        ruleName,
        ruleTargetId,
        rulePermissionId,
      });

      // Wait 60 seconds before starting new executions to allow the Cloudwatch rule to settle.
      // This prevents failure to decrement the semaphore.
      await sleep(60000);

      await sendStartSfMessages({
        numOfMessages: totalNumMessages,
        queueMaxExecutions,
        queueUrl: maxQueueUrl,
        workflowArn: waitPassSfArn,
      });
    });

    afterAll(async () => {
      await deleteCloudwatchRuleWithTargets({
        functionName: semaphoreDownLambda,
        ruleName,
        rulePermissionId,
        ruleTargetId,
      });

      await Promise.all([
        sqs().deleteQueue({
          QueueUrl: maxQueueUrl,
        }),
        dynamodbDocClient().delete({
          TableName: `${config.stackName}-SemaphoresTable`,
          Key: {
            key: maxQueueUrl,
          },
        }),
      ]);
    });

    it('consumes the right amount of messages', async () => {
      const { Payload } = await lambda().send(new InvokeCommand({
        FunctionName: `${config.stackName}-sqs2sfThrottle`,
        InvocationType: 'RequestResponse',
        Payload: new TextEncoder().encode(JSON.stringify({
          queueUrl: maxQueueUrl,
          messageLimit: totalNumMessages,
        })),
      }));

      messagesConsumed = Number.parseInt(Payload, 10);
      if (Number.isNaN(messagesConsumed)) {
        console.log('payload returned from sqs2sfThrottle', JSON.stringify(new TextDecoder('utf-8').decode(Payload)));
      }
      // Can't test that the messages consumed is exactly the number the
      // maximum allowed because of eventual consistency in SQS
      expect(messagesConsumed).toBeGreaterThan(0);
    });

    it('to trigger workflows', async () => {
      const { executions } = await StepFunctions.listExecutions({ stateMachineArn: waitPassSfArn });
      const runningExecutions = executions.filter((execution) => execution.status === 'RUNNING');
      expect(runningExecutions.length).toBeLessThanOrEqual(queueMaxExecutions);
    });
  });

  describe('when provided a queue that is configured to be rate-limited', () => {
    const numberOfMessagesPerQueue = 300;
    let rateLimitedQueueUrls;
    beforeAll(async () => {
      const rateLimitedQueueNames = [
        `${testName}RateLimitedQueue1`,
        `${testName}RateLimitedQueue2`,
        `${testName}RateLimitedQueue3`,
        `${testName}RateLimitedQueue4`,
      ];
      rateLimitedQueueUrls = await Promise.all(rateLimitedQueueNames.map((rateLimitedQueueName) =>
        sqs().createQueue({
          QueueName: rateLimitedQueueName,
          Attributes: {
            VisibilityTimeout: '600',
          },
        })));

      await Promise.all(rateLimitedQueueUrls.map(({ QueueUrl }) =>
        sendStartSfMessages({
          numOfMessages: numberOfMessagesPerQueue,
          queueMaxExecutions: 1000,
          queueUrl: QueueUrl,
          workflowArn: passSfArn,
        })));
    });

    afterAll(async () => {
      await Promise.all(rateLimitedQueueUrls.map(({ QueueUrl }) =>
        sqs().deleteQueue({
          QueueUrl,
        })));
    });

    const rateLimitPerSecond = 5;

    it('consumes messages at the specified rate', async () => {
      const { Payload } = await lambda().send(new InvokeCommand({
        FunctionName: `${config.stackName}-sqs2sfThrottleRateLimited`,
        InvocationType: 'RequestResponse',
        Payload: new TextEncoder().encode(JSON.stringify({
          queueUrls: rateLimitedQueueUrls.map(({ QueueUrl }) => QueueUrl),
          rateLimitPerSecond,
        })),
      }));
      const messagesConsumed = Number(new TextDecoder().decode(Payload));

      const expectedMessageCountNominal = rateLimitPerSecond * 60;
      const uncertaintyMargin = expectedMessageCountNominal * 0.1;
      const expectedMessageCountMax = expectedMessageCountNominal + uncertaintyMargin;
      const expectedMessageCountMin = expectedMessageCountNominal - uncertaintyMargin;
      expect(messagesConsumed).toBeLessThan(expectedMessageCountMax);
      expect(messagesConsumed).toBeGreaterThan(expectedMessageCountMin);
    });
    it('Does not result in messages entering their visibility timeout', async () => {
      // Wait 60 seconds for the ApproximateNumberOfMessagesNotVisible to update
      await sleep(60000);
      await Promise.all(rateLimitedQueueUrls.map(async ({ QueueUrl }) => {
        const { Attributes } = await sqs().getQueueAttributes({
          QueueUrl: QueueUrl,
          AttributeNames: ['ApproximateNumberOfMessagesNotVisible'],
        });
        const numMessagesNotVisible = Number(Attributes.ApproximateNumberOfMessagesNotVisible);
        expect(numMessagesNotVisible).toEqual(0);
      }));
    });
  });
});
