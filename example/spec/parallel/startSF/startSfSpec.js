'use strict';

const { lambda, sfn, sqs } = require('@cumulus/common/aws');
const StepFunctions = require('@cumulus/common/StepFunctions');
const { loadConfig, createTimestampedTestId, timestampedName } = require('../../helpers/testUtils');

const config = loadConfig();

const testName = createTimestampedTestId(config.stackName, 'testStartSf');

const passSfName = timestampedName('passTestSf');
const passSfDef = {
  Comment: 'Pass-only step function',
  StartAt: 'PassState',
  States: {
    PassState: {
      Type: 'Pass',
      Result: '$.payload',
      End: true
    }
  }
};
const passSfRoleArn = `arn:aws:iam::${config.awsAccountId}:role/${config.stackName}-steprole`;

const passSfParams = {
  name: passSfName,
  definition: JSON.stringify(passSfDef),
  roleArn: passSfRoleArn
};

const sfStarterName = `${config.stackName}-sqs2sf`;

function generateStartSfMessages(num, workflowArn) {
  const arr = [];
  for (let i = 0; i < num; i += 1) {
    arr.push({ cumulus_meta: { state_machine: workflowArn }, payload: `message #${i}` });
  }
  return arr;
}

describe('the sf-starter lambda function', () => {
  let queueUrl;

  beforeAll(async () => {
    const { QueueUrl } = await sqs().createQueue({
      QueueName: `${testName}Queue`
    }).promise();
    queueUrl = QueueUrl;
  });

  afterAll(async () => {
    await sqs().deleteQueue({
      QueueUrl: queueUrl
    }).promise();
  });

  it('has a configurable message limit', () => {
    const messageLimit = config.sqs_consumer_rate;
    expect(messageLimit).toBe(300);
  });

  describe('when provided a queue', () => {
    const initialMessageCount = 30;
    const testMessageLimit = 25;
    let passSfArn;
    let qAttrParams;
    let messagesConsumed;

    beforeAll(async () => {
      qAttrParams = {
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
      };
      const { stateMachineArn } = await sfn().createStateMachine(passSfParams).promise();
      passSfArn = stateMachineArn;
      const msgs = generateStartSfMessages(initialMessageCount, passSfArn);
      await Promise.all(msgs.map((msg) => sqs().sendMessage({ QueueUrl: queueUrl, MessageBody: JSON.stringify(msg) }).promise()));
    });

    afterAll(async () => {
      await sfn().deleteStateMachine({ stateMachineArn: passSfArn }).promise();
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

    it('to trigger workflows', async () => {
      const { executions } = await StepFunctions.listExecutions({ stateMachineArn: passSfArn });
      expect(executions.length).toBe(messagesConsumed);
    });
  });
});
