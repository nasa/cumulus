const test = require('ava');
const sinon = require('sinon');

const { createSnsTopic } = require('../SNS'); // replace with the actual path
const { sns } = require('../services');

test('createSnsTopic creates a topic and returns its ARN', async (t) => {
  // Arrange
  const snsTopicName = 'testTopic';
  const mockTopicArn = 'arn:aws:sns:us-east-1:123456789012:testTopic';

  // Mock the sns function and the send method
  const sendMock = sinon.stub().returns({ TopicArn: mockTopicArn });
  sinon.stub(sns(), 'send').callsFake(sendMock);

  // Act
  const result = await createSnsTopic(snsTopicName);

  // Assert
  t.is(result.TopicArn, mockTopicArn);
  t.like(sendMock.getCalls()[0].args[0].input, { Name: snsTopicName, KmsMasterKeyId: 'alias/aws/sns' });
});
