'use strict';

const nock = require('nock');
const test = require('ava');

const getConceptMetadata = require('../getConcept');

test.beforeEach(() => {
  nock.cleanAll();
});

test.serial('get CMR metadata, success', async (t) => {
  nock('https://www.example.com')
    .get('/')
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

  const response = await getConceptMetadata('https://www.example.com');
  t.is(response.title, 'MOD09GQ.A2016358.h13v04.006.2016360104606');
});

test.serial('get CMR metadata, fail', async (t) => {
  nock('https://www.example.com')
    .get('/')
    .reply(404);

  const response = await getConceptMetadata('https://www.example.com');
  t.is(response, null);
});
