'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');

const { randomId, randomString } = require('@cumulus/common/test-utils');

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
} = require('@cumulus/db');

// import the express app after setting the env variables
const { app } = require('../../../app');

test.before(async (t) => {
  const concurrency = 200;
  const granuleTotal = 10001;
  const { default: pTimes } = await import('p-times');
  process.env.NODE_ENV = 'test';
  process.env.auth_mode = 'private';
  process.env.dbMaxPool = concurrency;

  // Generate a local test postGres database
  t.context.testDbName = `granules_${cryptoRandomString({ length: 10 })}`;
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: t.context.testDbName,
  };

  const granulePgModel = new GranulePgModel();

  const collectionName = randomString(5);
  const collectionVersion = randomString(3);
  const testPgCollection = fakeCollectionRecordFactory({
    name: collectionName,
    version: collectionVersion,
  });

  const collectionPgModel = new CollectionPgModel();
  const collectionPgRecords = await collectionPgModel.create(
    knex,
    testPgCollection
  );
  // iterate 10k times
  await pTimes(granuleTotal, ((index) => {
    if (index % 1000 === 0 && index !== 0) {
      console.log('Creating granule', index);
    }
    const newPgGranule = fakeGranuleRecordFactory({
      granule_id: randomString(25),
      collection_cumulus_id: collectionPgRecords[0].cumulus_id,
    });
    return granulePgModel.create(knex, newPgGranule);
  }), { concurrency });
});

test.after.always(async (t) => {
  delete process.env.auth_mode;
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName: t.context.testDbName,
  });
});

test.serial('CUMULUS-2930/3967 /GET granules allows searching past 10K results windows using pagination', async (t) => {
  const response = await request(app)
    .get('/granules?limit=100&page=101')
    .set('Accept', 'application/json')
    .expect(200);

  t.is(response.body.results.length, 1);
});
