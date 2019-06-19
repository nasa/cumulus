'use strict';

const {
  lambda,
  sfn,
  sqs,
  s3PutObject,
  deleteS3Object,
  dynamodbDocClient
} = require('@cumulus/common/aws');
const StepFunctions = require('@cumulus/common/StepFunctions');
const {
  addCollections,
  deleteCollections
} = require('@cumulus/integration-tests');
const {
  deleteRule,
  postRule,
  rerunRule
} = require('@cumulus/integration-tests/api/rules');

const {
  loadConfig,
  createTimestampedTestId,
  timestampedName,
  createTestSuffix
} = require('../../helpers/testUtils');

const config = loadConfig();

const testName = createTimestampedTestId(config.stackName, 'testStartSf');
const testSuffix = createTestSuffix(testName);

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
      Seconds: 5,
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

const sfStarterName = `${config.stackName}-sqs2sf`;

function generateStartSfMessages(num, workflowArn) {
  const arr = [];
  for (let i = 0; i < num; i += 1) {
    arr.push({ cumulus_meta: { state_machine: workflowArn }, payload: `message #${i}` });
  }
  return arr;
}

describe('the sf-starter lambda function', () => {
  it('has a configurable message limit', () => {
    const messageLimit = config.sqs_consumer_rate;
    expect(messageLimit).toBe(300);
  });

  describe('when provided a queue', () => {
    const initialMessageCount = 30;
    const testMessageLimit = 25;
    let qAttrParams;
    let messagesConsumed;
    let passSfArn;
    let queueUrl;

    beforeAll(async () => {
      console.log(`queue name: ${testName}Queue`);

      const { QueueUrl } = await sqs().createQueue({
        QueueName: `${testName}Queue`
      }).promise();
      queueUrl = QueueUrl;

      qAttrParams = {
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
      };

      const { stateMachineArn } = await sfn().createStateMachine(passSfParams).promise();
      passSfArn = stateMachineArn;

      const msgs = generateStartSfMessages(initialMessageCount, passSfArn);
      await Promise.all(
        msgs.map((msg) =>
          sqs().sendMessage({ QueueUrl: queueUrl, MessageBody: JSON.stringify(msg) }).promise())
      );
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
      const response = await lambda().invoke({
        FunctionName: sfStarterName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          queueUrl,
          messageLimit: testMessageLimit
        })
      }).promise();
      console.log('time', new Date());
      console.log('response', response);
      const { Payload } = response;
      console.log(`request ID: ${response.$response.requestId}`);
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
      console.log(`Pass SF arn: ${passSfArn}`);
      const { executions } = await StepFunctions.listExecutions({ stateMachineArn: passSfArn });
      expect(executions.length).toBe(messagesConsumed);
    });
  });

  describe('when provided a queue with a maximum number of executions', () => {
    let maxQueueUrl;
    let maxQueueName;
    let templateKey;
    let templateUri;
    let messagesConsumed;
    let waitPassSfArn;
    const doStateMachineDelete = true;

    const queueMaxExecutions = 5;
    const numberOfMessages = 20;

    const collectionsDir = './data/collections/s3_MOD09GQ_006';
    const collection = {
      name: `MOD09GQ${testSuffix}`,
      dataType: `MOD09GQ${testSuffix}`,
      version: '006'
    };

    const ruleName = timestampedName('waitPassRule');

    beforeAll(async () => {
      console.log('testName', testName);

      maxQueueName = `${testName}MaxQueue`;
      console.log(`max queue name: ${maxQueueName}`);

      const { QueueUrl } = await sqs().createQueue({
        QueueName: maxQueueName
      }).promise();
      maxQueueUrl = QueueUrl;

      templateKey = `${config.stackName}/workflows/${waitPassSfName}.json`;
      templateUri = `s3://${config.bucket}/${templateKey}`;

      console.log('expected template URI', templateUri);

      const { stateMachineArn } = await sfn().createStateMachine(waitPassSfParams).promise();
      waitPassSfArn = stateMachineArn;

      console.log(`expected waitPass state machine ARN: ${waitPassSfArn}`);

      await s3PutObject({
        Bucket: config.bucket,
        Key: templateKey,
        Body: JSON.stringify({
          cumulus_meta: {
            state_machine: waitPassSfArn
          },
          meta: {
            queues: {
              [maxQueueName]: maxQueueUrl
            },
            queueExecutionLimits: {
              [maxQueueName]: queueMaxExecutions
            }
          }
        })
      });

      await Promise.all([
        postRule({
          prefix: config.stackName,
          rule: {
            name: ruleName,
            workflow: waitPassSfName,
            collection: {
              name: collection.name,
              version: collection.version
            },
            state: 'ENABLED',
            rule: {
              type: 'onetime'
            },
            queueName: maxQueueName
          }
        }),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix)
      ]);

      const runRules = new Array(8)
        .fill()
        .map(() => rerunRule({
          prefix: config.stackName,
          ruleName
        }));

      await Promise.all(runRules);
    });

    afterAll(async () => {
      const deleteStateMachine = doStateMachineDelete ?
        sfn().deleteStateMachine({ stateMachineArn: waitPassSfArn }).promise() :
        Promise.resolve();

      // Have to delete rule before associated collection
      await deleteRule({
        prefix: config.stackName,
        ruleName
      });

      await Promise.all([
        deleteS3Object(config.bucket, templateKey),
        sqs().deleteQueue({
          QueueUrl: maxQueueUrl
        }).promise(),
        deleteCollections(config.stackName, config.bucket, [collection]),
        deleteStateMachine,
        dynamodbDocClient().delete({
          TableName: `${config.stackName}-SemaphoresTable`,
          Key: {
            key: maxQueueName
          }
        }).promise()
      ]);
    });

    xit('queue-granules returns the correct amount of queued executions', async () => {
      const granules = new Array(numberOfMessages)
        .fill()
        .map((value) => ({
          granuleId: `granule${value}`,
          dataType: collection.dataType,
          version: collection.version,
          files: []
        }));

      const response = await lambda().invoke({
        FunctionName: `${config.stackName}-QueueGranules`,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          cumulus_meta: {
            message_source: 'local',
            execution_name: 'test-execution',
            task: 'QueueGranules'
          },
          meta: {
            stack: config.stackName,
            buckets: {
              internal: {
                name: config.bucket
              }
            },
            templates: {
              [waitPassSfName]: templateUri
            },
            provider: {},
            queues: {
              [maxQueueName]: maxQueueUrl
            }
          },
          workflow_config: {
            QueueGranules: {
              stackName: '{{$.meta.stack}}',
              queueUrl: `{{$.meta.queues.${maxQueueName}}}`,
              granuleIngestMessageTemplateUri: `{{$.meta.templates.${waitPassSfName}}}`,
              provider: '{{$.meta.provider}}',
              internalBucket: '{{$.meta.buckets.internal.name}}'
            }
          },
          payload: {
            granules: granules
          }
        })
      }).promise();
      const { Payload } = response;

      console.log(`request ID: ${response.$response.requestId}`);

      const { payload } = JSON.parse(Payload);
      expect(payload.running.length).toEqual(numberOfMessages);
    });

    it('consumes the right amount of messages', async () => {
      console.log('test');
      const response = await lambda().invoke({
        FunctionName: `${config.stackName}-sqs2sfThrottle`,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          queueUrl: maxQueueUrl,
          messageLimit: numberOfMessages
        })
      }).promise();

      console.log(response);
      const { Payload } = response;

      messagesConsumed = parseInt(Payload, 10);
      console.log('messages consumed', messagesConsumed);
      // Can't test that the messages consumed is exactly the number the
      // maximum allowed because of eventual consistency in SQS
      expect(messagesConsumed).toBeGreaterThan(0);
    });

    it('to trigger workflows', async () => {
      console.log(waitPassSfArn);
      const { executions } = await StepFunctions.listExecutions({ stateMachineArn: waitPassSfArn });
      const runningExecutions = executions.filter((execution) => execution.status === 'RUNNING');
      // if (executions.length !== messagesConsumed) {
      //   doStateMachineDelete = false;
      //   console.log(executions.map((execution) => execution.name));
      // }
      // There can be delays starting up executions, but there shouldn't be any
      // more executions than messages consumed
      // expect(executions.length).toBeLessThanOrEqual(messagesConsumed);
      console.log(`all executions: ${executions.length}`);
      console.log('running executions', runningExecutions);
      expect(runningExecutions.length).toBeLessThanOrEqual(queueMaxExecutions);
    });
  });
});
