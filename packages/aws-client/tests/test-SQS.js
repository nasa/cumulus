const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { Console } = require('console');
const { Writable } = require('stream');
const Logger = require('@cumulus/logger');

const { sqs } = require('../services');
const {
  createQueue,
  getQueueNameFromUrl,
  parseSQSMessageBody,
  sqsQueueExists,
  sendSQSMessage,
  isSQSRecordLike,
  receiveSQSMessages,
  limitSQSMessageLength,
} = require('../SQS');

const randomString = () => cryptoRandomString({ length: 10 });
class TestStream extends Writable {
  constructor(options) {
    super(options);

    this.output = '';
  }

  _write(chunk, _encoding, callback) {
    this.output += chunk;
    callback();
  }
}

class TestConsole extends Console {
  constructor() {
    const stdoutStream = new TestStream();
    const stderrStream = new TestStream();

    super(stdoutStream, stderrStream);

    this.stdoutStream = stdoutStream;
    this.stderrStream = stderrStream;
  }

  get stdoutLogEntries() {
    return this.stdoutStream.output
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map(JSON.parse);
  }

  get stderrLogEntries() {
    return this.stderrStream.output
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map(JSON.parse);
  }
}

test('parseSQSMessageBody parses messages correctly', (t) => {
  const messageBody = { test: 'value' };
  const bodyString = JSON.stringify(messageBody);
  t.deepEqual(parseSQSMessageBody({ Body: bodyString }), messageBody);
  t.deepEqual(parseSQSMessageBody({ body: bodyString }), messageBody);
  t.deepEqual(parseSQSMessageBody({}), {});
});

test('sqsQueueExists detects if the queue does not exist or is not accessible', async (t) => {
  const queueUrl = await createQueue(randomString());
  t.true(await sqsQueueExists(queueUrl));
  t.false(await sqsQueueExists(randomString()));
  await sqs().deleteQueue({ QueueUrl: queueUrl });
});

test('getQueueNameFromUrl extracts queue name from a queue URL', (t) => {
  const queueName = 'MyQueue';
  const queueUrl = `https://sqs.us-east-2.amazonaws.com/123456789012/${queueName}`;
  const extractedName = getQueueNameFromUrl(queueUrl);
  t.is(extractedName, queueName);
});

test('sendSQSMessage logs errors', async (t) => {
  const testConsole = new TestConsole();
  const log = new Logger({ console: testConsole });

  await t.throwsAsync(
    sendSQSMessage('fakequeue', 'Queue message', log),
    { instanceOf: Error }
  );

  t.is(testConsole.stderrLogEntries.length, 1);
  t.regex(testConsole.stderrLogEntries[0].message, /The specified queue does not exist/);
});

test('isSQSRecordLike filters correctly for sqs record shape', (t) => {
  t.false(isSQSRecordLike('aaa')); // must be an object
  t.false(isSQSRecordLike({ a: 'b' })); // object must contain a body
  t.true(isSQSRecordLike({ body: 'a' }));
  t.true(isSQSRecordLike({ Body: 'a' })); // must accept body or Body
  /* this is a bare check for body in object.
  body *should* be a string form json object,
  but strictly checking is not compatible with the current use-case*/
});

test('sendSQSMessage truncates oversized messages safely', async (t) => {
  const queueName = randomString();
  const queueUrl = await createQueue(queueName);
  const maxLength = 262144;
  const overflowMessage = '0'.repeat(maxLength + 2);
  await sendSQSMessage(queueUrl, overflowMessage);

  const recievedMessage = await receiveSQSMessages(queueUrl, {});
  const messageBody = recievedMessage[0].Body;
  t.true(messageBody.endsWith('...TruncatedForLength'));
  t.true(messageBody.length <= maxLength);
});

test('limitSQSMessageLength truncates unicode messages of greater than maximum byte size', async (t) => {

  const maxLength = 262144;
  const overflowMessageUnicodeMessage = 'è'.repeat(maxLength / 2 + 20);
  const massagedMessage = limitSQSMessageLength(overflowMessageUnicodeMessage);

  t.true(massagedMessage.endsWith('...TruncatedForLength'));
  t.true(massagedMessage.length <= maxLength);

  const overflowMessageMixedMessage = 'èa'.repeat(maxLength / 2 + 20);
  const massagedMixedMessage = limitSQSMessageLength(overflowMessageMixedMessage);

  t.true(massagedMixedMessage.endsWith('...TruncatedForLength'));
  t.true(massagedMixedMessage.length <= maxLength);
});

test('limitSQSMessageLength does not truncate messages appropriate for sqs to handle', async (t) => {
  const maxLength = 262144;
  let underflowMessage = '0'.repeat(maxLength);
  t.is(limitSQSMessageLength(underflowMessage), underflowMessage)


  underflowMessage = 'ř'.repeat(maxLength/2);
  t.is(limitSQSMessageLength(underflowMessage), underflowMessage)

  underflowMessage = 'a'.repeat(maxLength/2);
  t.is(limitSQSMessageLength(underflowMessage), underflowMessage)

  underflowMessage = 'abcd';
  t.is(limitSQSMessageLength(underflowMessage), underflowMessage)
});