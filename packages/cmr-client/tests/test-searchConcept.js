'use strict';

const got = require('got');
const sinon = require('sinon');
const test = require('ava');

const searchConcept = require('../searchConcept');

const clientId = 'cumulus-test-client';

test.serial('searchConcept request includes CMR client id', async (t) => {
  let request;
  const stub = sinon.stub(got, 'get').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return { body: { feed: { entry: [] } }, headers: { 'cmr-hits': 0 } };
  });

  await searchConcept({
    type: 'granule',
    searchParams: {},
    previousResults: [],
    headers: { 'Client-Id': clientId }
  });
  t.is(request.headers['Client-Id'], clientId);

  stub.restore();
});
