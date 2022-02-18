'use strict';

const test = require('ava');
const nock = require('nock');
const ORCASearchCatalogQueue = require('../../lib/ORCASearchCatalogQueue');

test.before(() => {
  nock.disableNetConnect();
  nock.cleanAll();
});

test.after.always(() => {
  nock.cleanAll();
});

process.env.orca_api_uri = 'https://orca_api_uri.com/orca';

test('ORCASearchCatalogQueue handles paging correctly.', async (t) => {
  const searchParams = { providerId: ['provider1'], collectionId: ['collectionId1'] };
  const body1 = '{"anotherPage":true,"granules":[{"orcaEntry1":"data1"}, {"orcaEntry2":"data2"}]}';
  const body2 = '{"anotherPage":true,"granules":[{"orcaEntry3":"data3"}, {"orcaEntry4":"data4"}]}';
  const body3 = '{"anotherPage":false,"granules":[{"orcaEntry5":"data5"}, {"orcaEntry6":"data6"}]}';

  nock('https://orca_api_uri.com')
    .post('/orca/catalog/reconcile', { ...searchParams, pageIndex: 0 })
    .reply(200, body1);

  nock('https://orca_api_uri.com')
    .post('/orca/catalog/reconcile', { ...searchParams, pageIndex: 1 })
    .reply(200, body2);

  nock('https://orca_api_uri.com')
    .post('/orca/catalog/reconcile', { ...searchParams, pageIndex: 2 })
    .reply(200, body3);

  const expected = [
    { orcaEntry1: 'data1' },
    { orcaEntry2: 'data2' },
    { orcaEntry3: 'data3' },
    { orcaEntry4: 'data4' },
    { orcaEntry5: 'data5' },
    { orcaEntry6: 'data6' },
  ];

  const orcaSearchQueue = new ORCASearchCatalogQueue(searchParams);
  for (let i = 0; i < 3; i += 1) {
    t.deepEqual(await orcaSearchQueue.peek(), expected[i]); // eslint-disable-line no-await-in-loop
    await orcaSearchQueue.shift(); // eslint-disable-line no-await-in-loop
  }

  t.deepEqual(await orcaSearchQueue.empty(), expected.slice(3));
});
