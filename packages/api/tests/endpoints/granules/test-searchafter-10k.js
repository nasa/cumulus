'use strict';

const test = require('ava');
const request = require('supertest');
const { randomId } = require('@cumulus/common/test-utils');
const { Search } = require('@cumulus/es-client/search');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const { loadGranules, granuleFactory } = require('@cumulus/es-client/tests/helpers/helpers');

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

// import the express app after setting the env variables
const { app } = require('../../../app');

test.before(async (t) => {
  process.env.NODE_ENV = 'test';
  t.context.esAlias = randomId('esalias');
  t.context.esIndex = randomId('esindex');
  process.env.ES_INDEX = t.context.esAlias;
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: t.context.esIndex,
    alias: t.context.esAlias,
  });
  t.context.esClient = await Search.es();

  process.env.auth_mode = 'private';
});

test.after.always(async (t) => {
  delete process.env.auth_mode;
  await t.context.esClient.indices.delete({ index: t.context.esIndex });
});

test.serial('CUMULUS-2930 /GET granules allows searching past 10K results windows with searchContext', async (t) => {
  const numGranules = 12 * 1;

  // create granules in batches of 1000
  for (let i = 0; i < numGranules; i += 1000) {
    const granules = granuleFactory(1000);
    // eslint-disable-next-line no-await-in-loop
    await loadGranules(granules, t);
    console.log(`${i} of ${numGranules} loaded`);
  }
  console.log('Granules loaded.');

  // expect numGranules / 100 loops since the api limit is 100;
  const expectedLoops = 1 + (numGranules / 100);
  let actualLoops = 0;
  let lastResults = [];
  let queryString = '';
  let searchContext = '';

  do {
    actualLoops += 1;
    // eslint-disable-next-line no-await-in-loop
    const response = await request(app)
      .get(`/granules?limit=100${queryString}`)
      .set('Accept', 'application/json')
      .expect(200);

    const results = response.body.results;
    t.notDeepEqual(results, lastResults);
    lastResults = results;

    searchContext = response.body.meta.searchContext;
    if (searchContext) {
      t.is(results.length, 100);
    } else {
      t.is(results.length, 0);
    }
    queryString = `&searchContext=${response.body.meta.searchContext}`;
  } while (searchContext !== undefined);

  t.is(lastResults.length, 0);
  t.is(actualLoops, expectedLoops);
});
