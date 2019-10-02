'use strict';

const {
  lambda,
  sfn,
  sqs,
  dynamodbDocClient,
  cloudwatchevents
} = require('@cumulus/common/aws');
const StepFunctions = require('@cumulus/common/StepFunctions');

const {
  loadConfig,
  createTimestampedTestId,
  timestampedName
} = require('../../helpers/testUtils');

const config = loadConfig();

const testName = createTimestampedTestId(config.stackName, 'testStartSf');

const passSfRoleArn = `arn:aws:iam::${config.awsAccountId}:role/${config.stackName}-steprole`;

const passSfName = timestampedName('passTestSf');
const passSfDef = {
  Comment: 'Pass-only step function',
  StartAt: 'PassState',
  States: {
    PassState: {
      Type: 'Pass',
      ResultPath: '$.payload',
      End: true
    }
  }
};

const passSfParams = {
  name: passSfName,
  definition: JSON.stringify(passSfDef),
  roleArn: passSfRoleArn
};

const waitPassSfName = timestampedName('waitPassTestSf');
const waitPassSfDef = {
  Comment: 'Pass-only step function',
  StartAt: 'WaitState',
  States: {
    WaitState: {
      Type: 'Wait',
      Seconds: 3,
      Next: 'PassState'
    },
    PassState: {
      Type: 'Pass',
      ResultPath: '$.payload',
      End: true
    }
  }
};

const waitPassSfParams = {
  name: waitPassSfName,
  definition: JSON.stringify(waitPassSfDef),
  roleArn: passSfRoleArn
};

async function sendStartSfMessages({
  numOfMessages,
  queueMaxExecutions,
  queueName,
  queueUrl,
  workflowArn
}) {
  const message = {
    cumulus_meta: {
      queueName,
      state_machine: workflowArn
    },
    meta: {
      queues: {
        [queueName]: queueUrl
      }
    }
  };

  if (queueMaxExecutions) {
    message.meta.queueExecutionLimits = {
      [queueName]: queueMaxExecutions
    };
  }

  const sendMessages = new Array(numOfMessages)
    .fill()
    .map(
      () =>
        sqs().sendMessage({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }).promise()
    );
  return Promise.all(sendMessages);
}

const createCloudwatchRuleWithTarget = async ({
  stateMachineArn,
  functionName,
  ruleName,
  ruleTargetId,
  rulePermissionId
}) => {
  const { RuleArn } = await cloudwatchevents().putRule({
    Name: ruleName,
    State: 'ENABLED',
    EventPattern: JSON.stringify({
      source: [
        'aws.states'
      ],
      'detail-type': [
        'Step Functions Execution Status Change'
      ],
      detail: {
        status: [
          'ABORTED',
          'FAILED',
          'SUCCEEDED',
          'TIMED_OUT'
        ],
        stateMachineArn: [
          stateMachineArn
        ]
      }
    })
  }).promise();

  const { Configuration } = await lambda().getFunction({
    FunctionName: functionName
  }).promise();

  await cloudwatchevents().putTargets({
    Rule: ruleName,
    Targets: [{
      Id: ruleTargetId,
      Arn: Configuration.FunctionArn
    }]
  }).promise();

  return lambda().addPermission({
    Action: 'lambda:InvokeFunction',
    FunctionName: functionName,
    Principal: 'events.amazonaws.com',
    StatementId: rulePermissionId,
    SourceArn: RuleArn
  }).promise();
};

const deleteCloudwatchRuleWithTargets = async ({
  functionName,
  ruleName,
  rulePermissionId,
  ruleTargetId
}) => {
  await cloudwatchevents().removeTargets({
    Ids: [
      ruleTargetId
    ],
    Rule: ruleName
  }).promise();

  await lambda().removePermission({
    FunctionName: functionName,
    StatementId: rulePermissionId
  }).promise();

  return cloudwatchevents().deleteRule({
    Name: ruleName
  }).promise();
};

describe('the sf-starter lambda function', () => {
  it('has a configurable message limit', () => {
    const messageLimit = config.sqs_consumer_rate;
    expect(messageLimit).toBe(300);
  });

  describe('when provided a queue', () => {
    const sfStarterName = `${config.stackName}-sqs2sf`;
    const initialMessageCount = 30;
    const testMessageLimit = 25;
    let qAttrParams;
    let messagesConsumed;
    let passSfArn;
    let queueName;
    let queueUrl;

    beforeAll(async () => {
      queueName = `${testName}Queue`;

      const { QueueUrl } = await sqs().createQueue({
        QueueName: queueName
      }).promise();
      queueUrl = QueueUrl;

      qAttrParams = {
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
      };

      const { stateMachineArn } = await sfn().createStateMachine(passSfParams).promise();
      passSfArn = stateMachineArn;

      await sendStartSfMessages({
        numOfMessages: initialMessageCount,
        queueName,
        queueUrl,
        workflowArn: passSfArn
      });
    });

    afterAll(async () => {
      await Promise.all([
        sfn().deleteStateMachine({ stateMachineArn: passSfArn }).promise(),
        sqs().deleteQueue({
          QueueUrl: queueUrl
        }).promise()
      ]);
    });

    it('that has messages', async () => {
      pending('until SQS provides a reliable getNumberOfMessages function');
      const { Attributes } = await sqs().getQueueAttributes(qAttrParams).promise();
      expect(Attributes.ApproximateNumberOfMessages).toBe(initialMessageCount.toString());
    });

    it('consumes the messages', async () => {
      const { Payload } = await lambda().invoke({
        FunctionName: sfStarterName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          queueUrl,
          messageLimit: testMessageLimit
        })
      }).promise();
      messagesConsumed = parseInt(Payload, 10);
      expect(messagesConsumed).toBeGreaterThan(0);
    });

    it('up to its message limit', async () => {
      pending('until SQS provides a way to confirm a given message/set of messages was deleted');
      const { Attributes } = await sqs().getQueueAttributes(qAttrParams).promise();
      const numOfMessages = parseInt(Attributes.ApproximateNumberOfMessages, 10); // sometimes returns 30 due to nature of SQS, failing test
      expect(numOfMessages).toBe(initialMessageCount - messagesConsumed);
    });

    /**
   * Failing intermittently
   * Filed CUMULUS-1367 to address
   */
    xit('to trigger workflows', async () => {
      const { executions } = await StepFunctions.listExecutions({ stateMachineArn: passSfArn });
      expect(executions.length).toBe(messagesConsumed);
    });
  });

  describe('when provided a queue with a maximum number of executions', () => {
    let maxQueueUrl;
    let maxQueueName;
    let messagesConsumed;
    let waitPassSfArn;
    let ruleName;
    let ruleTargetId;
    let rulePermissionId;

    const queueMaxExecutions = 5;
    const totalNumMessages = 20;
    const semaphoreDownLambda = `${config.stackName}-sfSemaphoreDown`;

    beforeAll(async () => {
      maxQueueName = `${testName}MaxQueue`;

      const { QueueUrl } = await sqs().createQueue({
        QueueName: maxQueueName
      }).promise();
      maxQueueUrl = QueueUrl;

      const { stateMachineArn } = await sfn().createStateMachine(waitPassSfParams).promise();
      waitPassSfArn = stateMachineArn;

      ruleName = timestampedName('waitPassSfRule');
      ruleTargetId = timestampedName('waitPassSfRuleTarget');
      rulePermissionId = timestampedName('waitPassSfRulePermission');

      await createCloudwatchRuleWithTarget({
        stateMachineArn: waitPassSfArn,
        functionName: semaphoreDownLambda,
        ruleName,
        ruleTargetId,
        rulePermissionId
      });

      await new Promise((res) => {
        // Wait 60 seconds before starting new executions to allow the Cloudwatch rule to settle.
        // This prevents failure to decrement the semaphore.
        setTimeout(res, 60000);
      });

      await sendStartSfMessages({
        numOfMessages: totalNumMessages,
        queueMaxExecutions,
        queueName: maxQueueName,
        queueUrl: maxQueueUrl,
        workflowArn: waitPassSfArn
      });
    });

    afterAll(async () => {
      await deleteCloudwatchRuleWithTargets({
        functionName: semaphoreDownLambda,
        ruleName,
        rulePermissionId,
        ruleTargetId
      });

      await Promise.all([
        sqs().deleteQueue({
          QueueUrl: maxQueueUrl
        }).promise(),
        sfn().deleteStateMachine({ stateMachineArn: waitPassSfArn }).promise(),
        dynamodbDocClient().delete({
          TableName: `${config.stackName}-SemaphoresTable`,
          Key: {
            key: maxQueueName
          }
        }).promise()
      ]);
    });

    it('consumes the right amount of messages', async () => {
      const { Payload } = await lambda().invoke({
        FunctionName: `${config.stackName}-sqs2sfThrottle`,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          queueUrl: maxQueueUrl,
          messageLimit: totalNumMessages
        })
      }).promise();
      messagesConsumed = parseInt(Payload, 10);
      // Can't test that the messages consumed is exactly the number the
      // maximum allowed because of eventual consistency in SQS
      expect(messagesConsumed).toBeGreaterThan(0);
    });

    /**
     * Failing intermittently
     * Filed CUMULUS-1367 to address
     */
    xit('to trigger workflows', async () => {
      const { executions } = await StepFunctions.listExecutions({ stateMachineArn: waitPassSfArn });
      const runningExecutions = executions.filter((execution) => execution.status === 'RUNNING');
      expect(runningExecutions.length).toBeLessThanOrEqual(queueMaxExecutions);
    });

    xdescribe('and the semaphore', () => {
      beforeAll(async () => {
        await sqs().purgeQueue({
          QueueUrl: maxQueueUrl
        });

        await new Promise((res) => {
          // Wait 10 seconds to allow running executions to finish.
          setTimeout(res, 10000);
        });
      });

      it('is decremented to 0', async () => {
        const semItem = await dynamodbDocClient().get({
          TableName: `${config.stackName}-SemaphoresTable`,
          Key: {
            key: maxQueueName
          }
        }).promise();
        expect(semItem.Item.semvalue).toBe(0);
      });
    });
  });
});
