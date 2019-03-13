'use strict';

const got = require('got');
const sinon = require('sinon');
const test = require('ava');
const ingestConcept = require('../ingestConcept');

const clientId = 'cumulus-test-client';
const granuleId = 'MYD13Q1.A2017297.h19v10.006.2017313221203';
const alreadyDeleted = `Concept with native-id [${granuleId}] and concept-id [G1222482315-CUMULUS] is already deleted.`;

// cmr responses for different status
const gotResponses = {
  200: {
    statusCode: 200,
    statusMessage: 'OK',
    body: '<result><concept-id>G1222482316-CUMULUS</concept-id><revision-id>9</revision-id></result>'
  },
  404: {
    statusCode: 404,
    statusMessage: 'not found',
    body: `<errors><error>${alreadyDeleted}</error></errors>`
  },
  400: {
    statusCode: 400,
    statusMessage: 'bad request',
    body: '<errors><error>Bad request</error></errors>'
  }
};

test.serial('ingestConcept request includes CMR client id', async (t) => {
  let request;
  const stub = sinon.stub(got, 'put').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return gotResponses[200];
  });
  // intercept validate
  const noPost = sinon.stub(got, 'post').callsFake(() => gotResponses[200]);

  await ingestConcept('granule', '<Granule><GranuleUR>granule1</GranuleUR></Granule>', 'Granule.GranuleUR', 'CUMULUS', { 'Client-Id': clientId });
  t.is(request.headers['Client-Id'], clientId);

  stub.restore();
  noPost.restore();
});
