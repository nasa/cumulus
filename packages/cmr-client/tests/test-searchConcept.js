'use strict';

const got = require('got');
const sinon = require('sinon');
const test = require('ava');

const { searchConcept } = require('../searchConcept');

const clientId = 'cumulus-test-client';

test.serial('searchConcept request includes CMR client id', async (t) => {
  let request;
  const stub = sinon.stub(got, 'get').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return { body: { feed: { entry: [] } }, headers: { 'cmr-hits': '0' } };
  });

  await searchConcept({
    type: 'granule',
    searchParams: {},
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
    searchParams: {},
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

    const searchParams = {
      arrayKey: 'value1',
      otherKey: 'otherValue',
    };

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
