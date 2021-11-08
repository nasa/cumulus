'use strict';

const test = require('ava');
const Logger = require('../dist');

test('buildMessage() returns the correct message', (t) => {
  const logger = new Logger();

  const logEvent = logger.buildMessage('warn', 'asdf');

  const parsedLogEvent = JSON.parse(logEvent);

  t.is(parsedLogEvent.message, 'asdf');
});

test('buildMessage() returns the correct level', (t) => {
  const logger = new Logger();

  const logEvent = logger.buildMessage('warn', 'asdf');

  const parsedLogEvent = JSON.parse(logEvent);

  t.is(parsedLogEvent.level, 'warn');
});
