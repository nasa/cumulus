'use strict';

const test = require('ava');
const Logger = require('../dist');

test('buildMessage() returns the correct message', async (t) => {
  const logger = new Logger();

  const logEvent = logger.buildMessage('warn', 'asdf');

  const parsedLogEvent = JSON.parse(logEvent);

  t.is(parsedLogEvent.message, 'asdf');
});

test('buildMessage() returns the correct level', async (t) => {
  const logger = new Logger();

  const logEvent = logger.buildMessage('warn', 'asdf');

  const parsedLogEvent = JSON.parse(logEvent);

  t.is(parsedLogEvent.level, 'warn');
});
