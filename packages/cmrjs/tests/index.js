'use strict';

const sinon = require('sinon');
const test = require('ava');
const got = require('got');
const { randomString } = require('@cumulus/common/test-utils');
const { deleteConcept, getMetadata } = require('..');

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

test('deleteConcept returns expected result when granule is in CMR', async (t) => {
  statusCode = 200;
  const stub = sinon.stub(got, 'delete').callsFake(stubclient.delete);

  const result = await deleteConcept('granules', granuleId, 'CUMULUS', randomString());
  stub.restore();
  t.is(result.result['concept-id'], 'G1222482316-CUMULUS');
});

test('deleteConcept returns success when granule is not found ', async (t) => {
  statusCode = 404;
  const stub = sinon.stub(got, 'delete').callsFake(stubclient.delete);
  return deleteConcept('granules', granuleId, 'CUMULUS', randomString())
    .then(() => {
      stub.restore();
      t.pass();
    })
    .catch(() => {
      stub.restore();
      t.fail();
    });
});

test('deleteConcept throws error when request is bad', (t) => {
  statusCode = 400;
  const stub = sinon.stub(got, 'delete').callsFake(stubclient.delete);
  return deleteConcept('granules', granuleId, 'CUMULUS', randomString())
    .then(() => {
      stub.restore();
      t.fail();
    })
    .catch((err) => {
      stub.restore();
      t.true(err.toString().includes('CMR error message: "Bad request"'));
    });
});

test('get CMR metadata, success', async (t) => {
  statusCode = 200;
  const stub = sinon.stub(got, 'get').callsFake(stubclient.getCmrData);

  await getMetadata('fakeLink')
    .then((response) => {
      t.is(response.title, 'MOD09GQ.A2016358.h13v04.006.2016360104606');
    });

  stub.restore();
});

test('get CMR metadata, fail', async (t) => {
  statusCode = 404;
  const stub = sinon.stub(got, 'get').callsFake(stubclient.getCmrData);

  await getMetadata('fakeLink')
    .then((response) => {
      t.is(response, null);
    });

  stub.restore();
});
