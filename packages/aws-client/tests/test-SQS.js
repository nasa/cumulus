const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const awsServices = require('../services');
const {
  createQueue,
  sqsQueueExists
} = require('../SQS');

test('sqsQueueExists detects if the queue does not exist or is not accessible', async (t) => {
  const queueUrl = await createQueue(randomString());
  const queueName = queueUrl.split('/').pop();
  t.true(await sqsQueueExists(queueUrl));
  t.true(await sqsQueueExists(queueName));
  t.false(await sqsQueueExists(randomString()));
  await awsServices.sqs().deleteQueue({ QueueUrl: queueUrl }).promise();
});
