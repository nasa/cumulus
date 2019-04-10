'use strict';

const got = require('got');
const sinon = require('sinon');
const test = require('ava');

const deleteConcept = require('../deleteConcept');

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

let statusCode;
const stubclient = {
  delete: () => {
    if (statusCode === 200) {
      return Promise.resolve(gotResponses[statusCode]);
    }
    const error = new Error();
    error.response = gotResponses[statusCode];
    return Promise.reject(error);
  },
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

test.serial('deleteConcept returns expected result when granule is in CMR', async (t) => {
  statusCode = 200;
  const stub = sinon.stub(got, 'delete').callsFake(stubclient.delete);

  const result = await deleteConcept('granule', granuleId, 'CUMULUS', {});
  stub.restore();
  t.is(result.result['concept-id'], 'G1222482316-CUMULUS');
});

test.serial('deleteConcept returns success when granule is not found ', async (t) => {
  statusCode = 404;
  const stub = sinon.stub(got, 'delete').callsFake(stubclient.delete);
  try {
    await deleteConcept('granule', granuleId, 'CUMULUS', {});
    t.pass();
  } catch (error) {
    t.fail();
  }
  stub.restore();
});

test.serial('deleteConcept throws error when request is bad', async (t) => {
  statusCode = 400;
  const stub = sinon.stub(got, 'delete').callsFake(stubclient.delete);
  try {
    await deleteConcept('granule', granuleId, 'CUMULUS', {});
    t.fail();
  } catch (error) {
    t.true(error.toString().includes('CMR error message: "Bad request"'));
  }
  stub.restore();
});

test.serial('deleteConcept request includes CMR client id', async (t) => {
  let request;
  const stub = sinon.stub(got, 'delete').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return gotResponses[200];
  });

  await deleteConcept('granule', granuleId, 'CUMULUS', { 'Client-Id': clientId });
  t.is(request.headers['Client-Id'], clientId);

  stub.restore();
});
