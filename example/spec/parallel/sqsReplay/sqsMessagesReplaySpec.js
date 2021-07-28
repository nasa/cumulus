'use strict';

const { randomString } = require('@cumulus/common/test-utils');
const { invokeApi } = require('@cumulus/api-client');
const { sqs } = require('@cumulus/aws-client/services');
const { receiveSQSMessages, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const { getS3KeyForArchivedMessage } = require('@cumulus/ingest/sqs');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
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
describe('The replay SQS messages API endpoint', () => {
  const message = JSON.stringify({ testdata: randomString() });

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

      const sqsMessage = await sendSQSMessage(queueUrl, message);

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
        path: '/replaySqsMessages',
        body: JSON.stringify(apiRequestBody),
      },
      expectedStatusCode: 202,
    });
    asyncOperationId = JSON.parse(response.body).asyncOperationId;
    expect(asyncOperationId).toBeDefined();
  });

  it('updates the async operation results with a list of replayed messages', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    const response = await waitForAsyncOperationStatus({
      id: asyncOperationId,
      status: 'SUCCEEDED',
      stackName: config.stackName,
      retryOptions: {
        retries: 30 * 5,
      },
    });
    const expected = JSON.parse(response.output)[0];

    expect(expected).toEqual(JSON.parse(message));
  });
});
