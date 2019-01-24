'use strict';

const sinon = require('sinon');
const nock = require('nock');
const test = require('ava');
const got = require('got');
const some = require('lodash.some');

const {
  CMR,
  deleteConcept,
  ingestConcept,
  searchConcept
} = require('../cmr');

const { getMetadata } = require('..');

const granuleId = 'MYD13Q1.A2017297.h19v10.006.2017313221203';
const clientId = 'test-client';

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

  const result = await deleteConcept('granules', granuleId, 'CUMULUS', {});
  stub.restore();
  t.is(result.result['concept-id'], 'G1222482316-CUMULUS');
});

test('deleteConcept returns success when granule is not found ', async (t) => {
  statusCode = 404;
  const stub = sinon.stub(got, 'delete').callsFake(stubclient.delete);
  return deleteConcept('granules', granuleId, 'CUMULUS', {})
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
  return deleteConcept('granules', granuleId, 'CUMULUS', {})
    .then(() => {
      stub.restore();
      t.fail();
    })
    .catch((error) => {
      stub.restore();
      t.true(error.toString().includes('CMR error message: "Bad request"'));
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

test('CMR.searchCollection handles paging correctly.', async (t) => {
  const headers = { 'cmr-hits': 6 };
  const body1 = '{"feed":{"updated":"sometime","id":"someurl","title":"fake Cmr Results","entry":[{"cmrEntry1":"data1"}, {"cmrEntry2":"data2"}]}}';
  const body2 = '{"feed":{"updated":"anothertime","id":"another url","title":"more Results","entry":[{"cmrEntry3":"data3"}, {"cmrEntry4":"data4"}]}}';
  const body3 = '{"feed":{"updated":"more time","id":"yet another","title":"morer Results","entry":[{"cmrEntry5":"data5"}, {"cmrEntry6":"data6"}]}}';

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/collections.json')
    .query((q) => q.page_num === '1')
    .reply(200, body1, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/collections.json')
    .query((q) => q.page_num === '2')
    .reply(200, body2, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/collections.json')
    .query((q) => q.page_num === '3')
    .reply(200, body3, headers);

  const expected = [
    { cmrEntry1: 'data1' },
    { cmrEntry2: 'data2' },
    { cmrEntry3: 'data3' },
    { cmrEntry4: 'data4' },
    { cmrEntry5: 'data5' },
    { cmrEntry6: 'data6' }
  ];

  const cmrSearch = new CMR('CUMULUS');
  const results = await cmrSearch.searchCollections({});

  t.is(expected.length, results.length);

  expected.forEach((expectedItem) => t.true(some(results, expectedItem)));
});

test('ingestConcept request includes CMR client id', async (t) => {
  let request;
  const stub = sinon.stub(got, 'put').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return gotResponses[200];
  });
  // intercept validate
  const noPost = sinon.stub(got, 'post').callsFake(() => gotResponses[200]);

  await ingestConcept('granules', '<Granule><GranuleUR>granule1</GranuleUR></Granule>', 'Granule.GranuleUR', 'CUMULUS', { 'Client-Id': clientId })
    .then(() => t.is(request.headers['Client-Id'], clientId));

  stub.restore();
  noPost.restore();
});

test('deleteConcept request includes CMR client id', async (t) => {
  let request;
  const stub = sinon.stub(got, 'delete').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return gotResponses[200];
  });

  await deleteConcept('granules', granuleId, 'CUMULUS', { 'Client-Id': clientId })
    .then(() => t.is(request.headers['Client-Id'], clientId));

  stub.restore();
});

test('searchConcept request includes CMR client id', async (t) => {
  let request;
  const stub = sinon.stub(got, 'get').callsFake((_url, opt) => {
    request = { headers: opt.headers };
    return { body: { feed: { entry: [] } }, headers: { 'cmr-hits': 0 } };
  });

  await searchConcept('granules', {}, [], { 'Client-Id': clientId }).then(() => t.is(request.headers['Client-Id'], clientId));

  stub.restore();
});
