'use strict';

const test = require('ava');
const nock = require('nock');
const {
  CMRSearchConceptQueue,
  providerParams,
} = require('../CMRSearchConceptQueue');

test.before(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.cleanAll();
});

test('CMRSearchConceptQueue handles paging correctly.', async (t) => {
  const headers = { 'cmr-hits': 6 };
  const body1 = '{"hits":6,"items":[{"cmrEntry1":"data1"}, {"cmrEntry2":"data2"}]}';
  const body2 = '{"hits":6,"items":[{"cmrEntry3":"data3"}, {"cmrEntry4":"data4"}]}';
  const body3 = '{"hits":6,"items":[{"cmrEntry5":"data5"}, {"cmrEntry6":"data6"}]}';

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/granules.umm_json')
    .query((q) => q.page_num === '1')
    .reply(200, body1, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/granules.umm_json')
    .query((q) => q.page_num === '2')
    .reply(200, body2, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/granules.umm_json')
    .query((q) => q.page_num === '3')
    .reply(200, body3, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .persist()
    .post('/legacy-services/rest/tokens')
    .reply(200, { token: 'ABCDE' });

  const expected = [
    { cmrEntry1: 'data1' },
    { cmrEntry2: 'data2' },
    { cmrEntry3: 'data3' },
    { cmrEntry4: 'data4' },
    { cmrEntry5: 'data5' },
    { cmrEntry6: 'data6' },
  ];
  process.env.CMR_ENVIRONMENT = 'UAT';
  const cmrSearchQueue = new CMRSearchConceptQueue({
    cmrSettings: {
      provider: 'CUMULUS',
      clientId: 'fakeClient',
      username: 'fakeUser',
      password: 'fakePassword',
      token: 'abcde',
    },
    type: 'granules',
    searchParams: new URLSearchParams(),
    format: 'umm_json',
  });
  for (let i = 0; i < 6; i += 1) {
    t.deepEqual(await cmrSearchQueue.peek(), expected[i]); // eslint-disable-line no-await-in-loop
    await cmrSearchQueue.shift(); // eslint-disable-line no-await-in-loop
  }
});

test('cmrSearchQueue provides correct initial params when SearchParams are an instanceOf URLSearchParams.', (t) => {
  const searchParams = new URLSearchParams([['key', 'param'], ['key', 'param2']]);
  const defaultParams = { cmrSettings: { provider: 'cmrprovider' } };
  const test1Params = { ...defaultParams, searchParams: searchParams };
  const actual = providerParams(test1Params);
  const expected = new URLSearchParams([['key', 'param'], ['key', 'param2'], ['provider_short_name', 'cmrprovider']]);
  t.deepEqual(actual, expected);
});

test('cmrSearchQueue provides correct initial params when SearchParams are a plain object.', (t) => {
  const searchParams = new URLSearchParams({ key: 'param' });
  const defaultParams = { cmrSettings: { provider: 'cmrprovider' } };
  const test1Params = { ...defaultParams, searchParams };
  const actual = providerParams(test1Params);
  const expected = new URLSearchParams({ key: 'param', provider_short_name: 'cmrprovider' });
  t.deepEqual(actual, expected);
});
