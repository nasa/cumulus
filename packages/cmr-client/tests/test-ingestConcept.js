'use strict';

const got = require('got');
const sinon = require('sinon');
const test = require('ava');
const { CMRInternalError } = require('@cumulus/errors');
const ingestConcept = require('../ingestConcept');

const clientId = 'cumulus-test-client';
const granuleId = 'MYD13Q1.A2017297.h19v10.006.2017313221203';
const alreadyDeleted = `Concept with native-id [${granuleId}] and concept-id [G1222482315-CUMULUS] is already deleted.`;
const conceptId = 'G1222482316-CUMULUS';

// cmr responses for different status
const gotResponses = {
  200: {
    statusCode: 200,
    statusMessage: 'OK',
    body: `<result><concept-id>${conceptId}</concept-id><revision-id>9</revision-id></result>`,
  },
  404: {
    statusCode: 404,
    statusMessage: 'not found',
    body: `<errors><error>${alreadyDeleted}</error></errors>`,
  },
  400: {
    statusCode: 400,
    statusMessage: 'bad request',
    body: '<errors><error>Bad request</error></errors>',
  },
  500: {
    statusCode: 500,
    statusMessage: 'internal error',
    body: '<errors><error>Internal error</error></errors>',
  },
};

test.serial('ingestConcept request includes CMR client id', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';

  let request;
  const stub = sinon.stub(got, 'put').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return gotResponses[200];
  });
  t.teardown(() => {
    stub.restore();
  });

  await ingestConcept(
    'granule',
    '<Granule><GranuleUR>granule1</GranuleUR></Granule>',
    'Granule.GranuleUR',
    'CUMULUS',
    { 'Client-Id': clientId }
  );
  t.is(request.headers['Client-Id'], clientId);
});

test.serial('ingestConcept response includes concept id', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';

  const stub = sinon.stub(got, 'put').resolves(gotResponses[200]);
  t.teardown(() => {
    stub.restore();
  });

  const response = await ingestConcept(
    'granule',
    '<Granule><GranuleUR>granule1</GranuleUR></Granule>',
    'Granule.GranuleUR',
    'CUMULUS',
    { 'Client-Id': clientId }
  );
  t.is(response.result['concept-id'], conceptId);
});

test.serial('ingestConcept returns CMRInternalError when CMR is down', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  const error = new Error();
  error.response = gotResponses[500];

  const stub = sinon.stub(got, 'put').rejects(error);
  t.teardown(() => {
    stub.restore();
  });

  await t.throwsAsync(
    ingestConcept(
      'granule',
      '<Granule><GranuleUR>granule1</GranuleUR></Granule>',
      'Granule.GranuleUR',
      'CUMULUS',
      { 'Client-Id': clientId }
    ),
    { instanceOf: CMRInternalError }
  );
});

test.serial('ingestConcept returns ingest error for bad request', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  const error = new Error();
  error.response = gotResponses[400];

  const stub = sinon.stub(got, 'put').rejects(error);
  t.teardown(() => {
    stub.restore();
  });

  await t.throwsAsync(
    ingestConcept(
      'granule',
      '<Granule><GranuleUR>granule1</GranuleUR></Granule>',
      'Granule.GranuleUR',
      'CUMULUS',
      { 'Client-Id': clientId }
    ),
    {
      name: 'Error',
      message: 'Failed to ingest, statusCode: 400, statusMessage: bad request, CMR error message: "Bad request"',
    }
  );
});

test.serial('ingestConcept returns ingest error when error has no response body', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  const error = new Error();
  error.code = 'ENOTFOUND';
  error.message = 'RequestError: getaddrinfo ENOTFOUND https://nonexisturl';

  const stub = sinon.stub(got, 'put').rejects(error);
  t.teardown(() => {
    stub.restore();
  });

  await t.throwsAsync(
    ingestConcept(
      'granule',
      '<Granule><GranuleUR>granule1</GranuleUR></Granule>',
      'Granule.GranuleUR',
      'CUMULUS',
      { 'Client-Id': clientId }
    ),
    {
      name: 'Error',
      message: 'Failed to ingest, statusCode: ENOTFOUND, statusMessage: RequestError: getaddrinfo ENOTFOUND https://nonexisturl',
    }
  );
});
