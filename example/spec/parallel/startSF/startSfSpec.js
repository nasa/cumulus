'use strict';

const { lambda, sfn, sqs } = require('@cumulus/common/aws');
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
const passSfRoleArn = config.iams.stepRoleArn;

const passSfParams = {
  name: passSfName,
  definition: JSON.stringify(passSfDef),
  roleArn: passSfRoleArn
};

const sfStarterName = `${config.stackName}-sqs2sf`;

function generateStartSfMessages(num, workflowArn) {
  const arr = [];
  for (let i = 0; i < num; i += 1) {
    arr.push({ MessageBody: { cumulus_meta: { state_machine: workflowArn }, payload: `message #${i}` } });
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
    const messageLimit = config.sqs.default_consumer_rate;
    expect(messageLimit).toBeDefined();
  });

  describe('consumes messages', () => {
    let passSfArn;
    const qAttrParams = {
      QueueUrl: queueUrl,
      Attributes: ['ApproximateNumberOfMessages']
    };

    beforeAll(async () => {
      const { stateMachineArn } = await sfn().createStateMachine(passSfParams).promise();
      passSfArn = stateMachineArn;
      const msgs = generateStartSfMessages(30, passSfArn);
      await Promise.all(msgs.map((msg) => sqs().sendMessage(msg).promise()));
    });

    afterAll(async () => {
      await sfn().deleteStateMachine({ stateMachineArn: passSfArn }).promise();
    });

    it('from the provided queue', async () => {
      let attrs = await sqs().getQueueAttribute(qAttrParams).promise();
      expect(attrs.ApproximateNumberOfMessages).toBe(30);
      const { Payload } = await lambda().invoke({
        FunctionName: sfStarterName,
        Type: 'RequestResponse',
        payload: JSON.stringify({
          queueUrl,
          messageLimit: 25
        })
      }).promise();
      expect(Payload).toBe(25);
      attrs = await sqs().getQueueAttribute(qAttrParams).promise();
      expect(attrs.ApproximateNumberOfMessages).toBe(5);
    });

    it('to trigger workflows', async () => {
      const { executions } = await sfn().listExecutions({ stateMachineArn: passSfArn }).promise();
      expect(executions.length).toBe(25);
    });
  });
});
