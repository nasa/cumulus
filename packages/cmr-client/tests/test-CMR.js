'use strict';

const test = require('ava');
const nock = require('nock');
const some = require('lodash.some');

const CMR = require('../CMR');

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

  const cmrSearch = new CMR();
  const results = await cmrSearch.searchCollections({ provider_short_name: 'CUMULUS' });

  t.is(expected.length, results.length);

  expected.forEach((expectedItem) => t.true(some(results, expectedItem)));
});

test('getHeaders returns correct Content-type for UMMG metadata', (t) => {
  const cmrInstance = new CMR('provider', 'clientID', 'username', 'password');
  const ummgVersion = '1.5';
  const headers = cmrInstance.getHeaders(null, ummgVersion);
  console.log(headers);
  t.is(headers['Content-type'], 'application/vnd.nasa.cmr.umm+json;version=1.5');
  t.is(headers.Accept, 'application/json');
});

test('getHeaders returns correct Content-type for xml metadata by default', (t) => {
  const cmrInstance = new CMR('provider', 'clientID', 'username', 'password');
  const headers = cmrInstance.getHeaders();
  console.log(headers);
  t.is(headers['Content-type'], 'application/echo10+xml');
  t.is(headers.Accept, undefined);
});
