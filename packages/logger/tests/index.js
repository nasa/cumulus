'use strict';

const { Console } = require('console');
const { Writable } = require('stream');
const moment = require('moment');
const test = require('ava');

const Logger = require('..');

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

test.beforeEach((t) => {
  t.context.testConsole = new TestConsole();
});

test('sender defaults to "unknown"', (t) => {
  const { testConsole } = t.context;
  const logger = new Logger({ console: testConsole });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].sender, 'unknown');
});

test('Logger.info() accepts placeholder arguments', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.info('%s %s', 'hello', 'world');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].message, 'hello world');
});

test('Logger.info() creates the expected log entry', (t) => {
  const { testConsole } = t.context;
  const logger = new Logger({ console: testConsole, sender: 'my-sender' });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);

  const logEntry = testConsole.stdoutLogEntries[0];

  t.is(logEntry.level, 'info');
  t.is(logEntry.message, 'hello');
  t.is(logEntry.sender, 'my-sender');
  t.is(moment(logEntry.timestamp, moment.ISO_8601, true).isValid(), true);
});

test('Logger.info() logs executions if specified', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({
    console: testConsole,
    executions: 'my-executions',
  });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].executions, 'my-executions');
});

test('Logger.info() logs granules if specified', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({
    console: testConsole,
    granules: '[{"granule":"testing"}]',
  });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].granules, '[{"granule":"testing"}]');
});

test('Logger.info() logs parentArn if specified', (t) => {
  const { testConsole } = t.context;
  const arnString = 'arn:aws:fakearnString';

  const logger = new Logger({
    console: testConsole,
    parentArn: arnString,
  });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].parentArn, arnString);
});

test('Logger.info() logs stackName if specified', (t) => {
  const { testConsole } = t.context;
  const stackName = 'fakeStackname';

  const logger = new Logger({
    console: testConsole,
    stackName,
  });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].stackName, stackName);
});

test('Logger.info() logs version if specified', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({
    console: testConsole,
    version: 'my-version',
  });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].version, 'my-version');
});

test('Logger.info() logs asyncOperationId if specified', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({
    console: testConsole,
    asyncOperationId: 'async-id-12345',
  });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].asyncOperationId, 'async-id-12345');
});

test('Logger.info() ignores unknown keys', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({
    console: testConsole,
    unknownKey: 'anything at all',
  });

  logger.info('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].unknownKey, undefined);
});

test('Logger.error() creates the expected log entry', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.error('hello');

  t.is(testConsole.stderrLogEntries.length, 1);
  t.is(testConsole.stderrLogEntries[0].level, 'error');
});

test('Logger.error() supports templates when an Error object is not passed', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.error('%s %s', 'hello', 'world');

  t.is(testConsole.stderrLogEntries.length, 1);
  t.is(testConsole.stderrLogEntries[0].message, 'hello world');
});

test('Logger.error() supports templates when an Error object is passed', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  try {
    throw new Error('so wrong');
  } catch (error) {
    logger.error('%s %s', 'hello', 'world', error);
  }

  t.is(testConsole.stderrLogEntries.length, 1);
  t.is(testConsole.stderrLogEntries[0].message, 'hello world');
});

test('Logger.error() logs info about an Error', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  try {
    throw new Error('test123');
  } catch (error) {
    logger.error('something bad', error);
  }

  const logEntry = testConsole.stderrLogEntries[0];

  t.is(testConsole.stderrLogEntries.length, 1);
  t.is(logEntry.message, 'something bad');

  t.is(logEntry.error.name, 'Error');
  t.is(logEntry.error.message, 'test123');
  t.true(Array.isArray(logEntry.error.stack));
  t.is(typeof logEntry.error.stack[0], 'string');
});

test('Logger.error() can handle just an Error', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  try {
    throw new Error('test123');
  } catch (error) {
    logger.error(error);
  }

  const logEntry = testConsole.stderrLogEntries[0];

  t.is(testConsole.stderrLogEntries.length, 1);
  t.is(logEntry.message, 'test123');

  t.is(logEntry.error.name, 'Error');
  t.is(logEntry.error.message, 'test123');
  t.true(Array.isArray(logEntry.error.stack));
  t.is(typeof logEntry.error.stack[0], 'string');
});

test('Logger.debug() creates the expected log entry', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.debug('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].level, 'debug');
});

test('Logger.warn() creates the expected log entry', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.warn('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].level, 'warn');
});

test('Logger.fatal() creates the expected log entry', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.fatal('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].level, 'fatal');
});

test('Logger.trace() creates the expected log entry', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.trace('hello');

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].level, 'trace');
});

test('Logger.infoWithAdditionalKeys() logs the specified keys', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.infoWithAdditionalKeys(
    {
      name: 'Frank',
      age: 42,
    },
    'hello'
  );

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].level, 'info');
  t.is(testConsole.stdoutLogEntries[0].name, 'Frank');
  t.is(testConsole.stdoutLogEntries[0].age, 42);
});

test('Logger.infoWithAdditionalKeys() does not overwrite the standard keys', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.infoWithAdditionalKeys(
    { level: 'another' },
    'hello'
  );

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].level, 'info');
});

test('Logger.info() allows an empty message to be logged', (t) => {
  const { testConsole } = t.context;

  const logger = new Logger({ console: testConsole });

  logger.info();

  t.is(testConsole.stdoutLogEntries.length, 1);
  t.is(testConsole.stdoutLogEntries[0].message, '');
});
