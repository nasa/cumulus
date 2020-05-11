'use strict';

const sinon = require('sinon');
const test = require('ava');
const got = require('got');

const getConceptMetadata = require('../getConcept');

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
    body: `<errors><error>Granule deleted</error></errors>`
  },
  400: {
    statusCode: 400,
    statusMessage: 'bad request',
    body: '<errors><error>Bad request</error></errors>'
  }
};

let statusCode;
const stubclient = {
  getCmrData: () => ({
    statusCode,
    body: JSON.stringify({
      feed: {
        entry: [{
          time_start: '2017-10-24T00:00:00.000Z',
          updated: '2018-04-25T21:45:45.524Z',
          dataset_id: 'MODIS/Terra Surface Reflectance Daily L2G Global 250m SIN Grid V006',
          data_center: 'CUMULUS',
          title: 'MOD09GQ.A2016358.h13v04.006.2016360104606'
        }]
      }
    })
  })
};

test.serial('get CMR metadata, success', async (t) => {
  statusCode = 200;
  const stub = sinon.stub(got, 'get').callsFake(stubclient.getCmrData);

  try {
    const response = await getConceptMetadata('fakeLink');
    t.is(response.title, 'MOD09GQ.A2016358.h13v04.006.2016360104606');
  } finally {
    stub.restore();
  }
});

test.serial('get CMR metadata, fail', async (t) => {
  statusCode = 404;
  const stub = sinon.stub(got, 'get').callsFake(stubclient.getCmrData);

  try {
    const response = await getConceptMetadata('fakeLink');
    t.is(response, null);
  } finally {
    stub.restore();
  }
});
