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
