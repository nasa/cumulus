const { v4: uuidv4 } = require('uuid');

const { createSnsTopic, deleteSnsTopic, subscribeSqsToSnsTopic } = require('@cumulus/aws-client/SNS');
const { createQueue, deleteQueue, receiveSQSMessages } = require('@cumulus/aws-client/SQS');
const { loadConfig } = require('../../helpers/testUtils');
const { executeWorkflow } = require('../../helpers/workflowUtils');

describe('The aws_api_proxy deployed within a Cumulus workflow', () => {
  let workflowExecution;
  let snsName;
  let createQueueUrl;
  const snsMessage = { foo: 'bar' };
  const workflowName = 'AwsApiProxyWorkflow';

  beforeAll(async () => {
    const randomPostfix = uuidv4().slice(0, 8);
    const config = await loadConfig();
    snsName = `${config.stackName}-test-sns-topic-${randomPostfix}`;
    const sqsName = `${config.stackName}-test-sqs-queue-${randomPostfix}`;

    // We need an SNS/SQS pair to confirm we've successfully published a message to the SNS topic
    const createTopicResponse = await createSnsTopic(snsName);

    // Construct the queue ARN for the policy (ARN format is predictable)
    const queueArn = `arn:aws:sqs:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${sqsName}`;

    // Create policy allowing SNS to send messages to the queue
    const queuePolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: 'sns.amazonaws.com',
          },
          Action: 'sqs:SendMessage',
          Resource: queueArn,
          Condition: {
            ArnEquals: {
              'aws:SourceArn': createTopicResponse.TopicArn,
            },
          },
        },
      ],
    };

    // Create queue with the policy
    createQueueUrl = await createQueue(sqsName, { Policy: JSON.stringify(queuePolicy) });

    // Subscribe the queue to the SNS topic
    await subscribeSqsToSnsTopic(createTopicResponse.TopicArn, queueArn);

    const executionMeta = {
      test_task_config: {
        service: 'sns',
        action: 'publish',
        parameters: {
          Message: snsMessage,
          TopicArn: createTopicResponse.TopicArn,
        },
        parameter_filters: [{
          name: 'json.dumps',
          field: 'Message',
        }],
      },
    };

    workflowExecution = await executeWorkflow(config.stackName, config.bucket, workflowName, {
      cumulus_meta: {},
      meta: executionMeta,
    });
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('completed');
  });

  it('successfully publishes a message to the SNS topic', async () => {
    const options = { numOfMessages: 10, waitTimeSeconds: 10 };
    const messages = await receiveSQSMessages(createQueueUrl, options);
    expect(messages.length).toEqual(1);
    const receivedMessage = messages[0];
    const receivedSnsMessage = JSON.parse(receivedMessage.Body).Message;
    expect(JSON.parse(receivedSnsMessage)).toEqual(snsMessage);
  });
  afterAll(async () => {
    // Construct SNS topic ARN from region, account ID, and topic name
    const snsArn = `arn:aws:sns:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${snsName}`;
    await deleteQueue(createQueueUrl);
    await deleteSnsTopic(snsArn);
  });
});
