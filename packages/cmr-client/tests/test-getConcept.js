'use strict';

const nock = require('nock');
const test = require('ava');

const getConceptMetadata = require('../getConcept');

test.beforeEach(() => {
  nock.cleanAll();
});

test.serial('get CMR metadata via concept search succeeds', async (t) => {
  nock('https://www.example.com')
    .get('/search/concepts/bar')
    .reply(200,
      JSON.stringify({
        time_start: '2017-10-24T00:00:00.000Z',
        updated: '2018-04-25T21:45:45.524Z',
        dataset_id: 'MODIS/Terra Surface Reflectance Daily L2G Global 250m SIN Grid V006',
        data_center: 'CUMULUS',
        title: 'MOD09GQ.A2016358.h13v04.006.2016360104606',
      }));
  const response = await getConceptMetadata('https://www.example.com/search/concepts/bar');
  t.is(response.title, 'MOD09GQ.A2016358.h13v04.006.2016360104606');
});

test.serial('get CMR metadata via granules search succeeds', async (t) => {
  nock('https://www.example.com')
    .get('/search/granules.json?foo=bar')
    .reply(200,
      JSON.stringify({
        feed: {
          entry: [{
            time_start: '2017-10-24T00:00:00.000Z',
            updated: '2018-04-25T21:45:45.524Z',
            dataset_id: 'MODIS/Terra Surface Reflectance Daily L2G Global 250m SIN Grid V006',
            data_center: 'CUMULUS',
            title: 'MOD09GQ.A2016358.h13v04.006.2016360104606',
          }],
        },
      }));

  const response = await getConceptMetadata('https://www.example.com/search/granules.json?foo=bar');
  t.is(response.title, 'MOD09GQ.A2016358.h13v04.006.2016360104606');
});

test.serial('get CMR metadata via granule search returns undefined on 404', async (t) => {
  nock('https://example.com')
    .get('/search/granules.json?foo=bar')
    .reply(404);

  const response = await getConceptMetadata(
    'https://example.com/search/granules.json?foo=bar',
    {}
  );
  t.is(response, undefined);
});

test.serial('get CMR metadata via concept search returns undefined on 404', async (t) => {
  nock('https://example.com')
    .get('/search/concepts/not-found')
    .reply(404);

  const response = await getConceptMetadata(
    'https://example.com/search/concepts/not-found',
    {}
  );
  t.is(response, undefined);
});

test.serial('get CMR metadata bubbles up and throws on non-404 errors', async (t) => {
  nock('https://example.com')
    .persist()
    .get('/search/concepts/server-error.json')
    .reply(500);

  const error = await t.throwsAsync(async () => {
    await getConceptMetadata(
      'https://example.com/search/concepts/server-error.json',
      {}
    );
  });

  t.is(error.response.statusCode, 500);
});
