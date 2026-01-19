'use strict';

const got = require('got');
const sinon = require('sinon');
const test = require('ava');
const { Console } = require('console');
const { Writable } = require('stream');

const { randomId } = require('@cumulus/common/test-utils');
const Logger = require('@cumulus/logger');
const { searchConcept } = require('../searchConcept');

process.env.CMR_ENVIRONMENT = 'SIT';

const clientId = 'cumulus-test-client';

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

test.serial('searchConcept request includes CMR client id', async (t) => {
  let request;
  const stub = sinon.stub(got, 'get').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return { body: { feed: { entry: [] } }, headers: { 'cmr-hits': '0' } };
  });

  await searchConcept({
    type: 'granule',
    searchParams: new URLSearchParams(),
    previousResults: [],
    headers: { 'Client-Id': clientId },
  });
  t.is(request.headers['Client-Id'], clientId);

  stub.restore();
});

test.serial('searchConcept uses env variables', async (t) => {
  let request;
  process.env.CMR_LIMIT = 2;
  const stub = sinon.stub(got, 'get').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return {
      body: { feed: { entry: ['first', 'second', 'third'] } },
      headers: { 'cmr-hits': '0' },
    };
  });

  const response = await searchConcept({
    type: 'granule',
    searchParams: new URLSearchParams(),
    previousResults: [],
    headers: { 'Client-Id': clientId },
  });
  t.is(response.length, 2);
  t.is(request.headers['Client-Id'], clientId);

  stub.restore();
});

test.serial(
  'searchConcept calls "got" with correct query when searchParams are URLSearchParams.',
  async (t) => {
    const stub = sinon.stub(got, 'get').callsFake((_url, _opt) => ({
      body: { feed: { entry: [] } },
      headers: { 'cmr-hits': '0' },
    }));

    const searchParams = new URLSearchParams([
      ['arrayKey', 'value1'],
      ['arrayKey', 'value2'],
      ['otherKey', 'otherValue'],
    ]);

    const expectedParams
          = 'arrayKey=value1&arrayKey=value2&otherKey=otherValue&page_num=1&page_size=50';

    await searchConcept({
      type: 'granule',
      searchParams,
      previousResults: [],
      headers: { 'Client-Id': 'any' },
    });

    const call = stub.getCall(0);
    // Validate searchParams object passed to GOT.get is what is expected.
    t.is(call.args[1].searchParams.toString(), expectedParams);

    stub.restore();
  }
);

test.serial(
  'searchConcept calls "got" with correct query when searchParams are an object.',
  async (t) => {
    const stub = sinon.stub(got, 'get').callsFake((_url, _opt) => ({
      body: { feed: { entry: [] } },
      headers: { 'cmr-hits': '0' },
    }));

    const searchParams = new URLSearchParams({
      arrayKey: 'value1',
      otherKey: 'otherValue',
    });

    const expectedParams
          = 'arrayKey=value1&otherKey=otherValue&page_num=1&page_size=50';

    await searchConcept({
      type: 'granule',
      searchParams,
      previousResults: [],
      headers: { 'Client-Id': 'any' },
    });

    const call = stub.getCall(0);
    // Validate searchParams object passed to GOT.get is what is expected.
    t.is(call.args[1].searchParams.toString(), expectedParams);

    stub.restore();
  }
);

test.only('searchConcept logs redacted Authorization header on error', async (t) => {
  const { testConsole } = t.context;
  const headers = { Authorization: `Bearer ${randomId('secret')}`, 'Client-Id': 'any' };

  const stub = sinon.stub(got, 'get').throws(new Error('CMR request failed'));

  const writeStub = sinon.stub(Logger.prototype, 'writeLogEvent').callsFake(function (level, messageArgs, additionalKeys) {
    const msg = this.buildLogEventMessage(level, messageArgs, additionalKeys);
    if (level === 'error') t.context.testConsole.error(msg);
    else t.context.testConsole.log(msg);
  });

  const searchParams = new URLSearchParams({
    arrayKey: 'value1',
    otherKey: 'otherValue',
  });

  try {
    await searchConcept({
      type: 'granule',
      searchParams,
      previousResults: [],
      headers: headers,
    });
  } catch {
    // Expected error
  }
  const errorLogs = testConsole.stderrLogEntries;
  const headerAuthorizationLog = errorLogs.find((log) => log.message.includes('Authorization'));
  t.true(headerAuthorizationLog.message.includes('"Authorization":"[REDACTED]"'));

  writeStub.restore();
  stub.restore();
});
