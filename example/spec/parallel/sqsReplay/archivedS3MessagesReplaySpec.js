'use strict';

const delay = require('delay');

const { randomString } = require('@cumulus/common/test-utils');
const { invokeApi } = require('@cumulus/api-client');
const { sqs } = require('@cumulus/aws-client/services');
const { receiveSQSMessages, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const { getS3KeyForArchivedMessage } = require('@cumulus/ingest/sqs');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const {
  createTimestampedTestId,
  loadConfig,
} = require('../../helpers/testUtils');

let asyncOperationId;
let beforeAllFailed = false;
let config;
let queueName;
let queueUrl;
let stackName;
let testName;

// The test setup entails creating SQS messages that will be archived in S3
describe('The replay archived S3 messages API endpoint', () => {
  const invalidMessage = JSON.stringify({ testdata: randomString() });

  beforeAll(async () => {
    try {
      config = await loadConfig();
      stackName = config.stackName;

      testName = createTimestampedTestId(config.stackName, 'archivedMessagesReplay');
      queueName = `${testName}Queue`;

      const { QueueUrl } = await sqs().createQueue({
        QueueName: queueName,
      }).promise();
      queueUrl = QueueUrl;

      const sqsMessage = await sendSQSMessage(queueUrl, invalidMessage);

      const sqsOptions = { numOfMessages: 10, waitTimeSeconds: 20 };
      const retrievedMessage = await receiveSQSMessages(queueUrl, sqsOptions);
      const key = getS3KeyForArchivedMessage(stackName, sqsMessage.MessageId, queueName);

      await s3PutObject({
        Bucket: config.bucket,
        Key: key,
        Body: retrievedMessage[0].Body,
      });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    await sqs().deleteQueue({
      QueueUrl: queueUrl,
    }).promise();
  });

  it('starts an AsyncOperation and returns an AsyncOperation ID when a valid SQS replay request is made', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    const apiRequestBody = {
      type: 'sqs',
      queueName: queueName,
    };
    const response = await invokeApi({
      prefix: stackName,
      payload: {
        httpMethod: 'POST',
        resource: '/{proxy+}',
        headers: {
          'Content-Type': 'application/json',
        },
        path: '/replayArchivedS3Messages',
        body: JSON.stringify(apiRequestBody),
      },
    });
    asyncOperationId = JSON.parse(response.body).asyncOperationId;
    expect(asyncOperationId).toBeDefined();
  });

  it('updates the async operation results with a list of replayed messages', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    await delay(100 * 1000);
    const response = await invokeApi({
      prefix: stackName,
      payload: {
        httpMethod: 'GET',
        resource: '/{proxy+}',
        path: `/asyncOperations/${asyncOperationId}`,
      },
    });
    const body = JSON.parse(response.body);
    const expected = JSON.parse(body.output)[0];

    expect(expected).toEqual(JSON.parse(invalidMessage));
  });
});
