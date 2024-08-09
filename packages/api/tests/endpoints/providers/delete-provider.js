'use strict';

const test = require('ava');
const request = require('supertest');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString, randomId } = require('@cumulus/common/test-utils');

const {
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  fakeRuleRecordFactory,
} = require('@cumulus/db/dist/test-utils');
const {
  destroyLocalTestDb,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  CollectionPgModel,
  RulePgModel,
  ProviderPgModel,
  migrationDir,
  translatePostgresProviderToApiProvider,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const indexer = require('@cumulus/es-client/indexer');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const { AccessToken } = require('../../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  createProviderTestRecords,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');
const { del } = require('../../../endpoints/providers');

const { buildFakeExpressResponse } = require('../utils');

const testDbName = randomId('db');

process.env.stackName = randomId('stack');
process.env.system_bucket = randomId('sysbucket');
process.env.TOKEN_SECRET = randomId('token');
process.env = {
  ...process.env,
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

// import the express app after setting the env variables
const { app } = require('../../../app');

let accessTokenModel;
let jwtAuthToken;

test.before(async (t) => {
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.rulePgModel = new RulePgModel();
  t.context.granulePgModel = new GranulePgModel();

  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomId('user');
  await setAuthorizedOAuthUsers([username]);

  process.env.AccessTokensTable = randomId('AccessTokens');
  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflow_template.json`,
    Body: JSON.stringify({}),
  });
});

test.beforeEach(async (t) => {
  const testPgProvider = fakeProviderRecordFactory();
  t.context.testPgProvider = testPgProvider;
  const [pgProvider] = await t.context.providerPgModel
    .create(
      t.context.testKnex,
      testPgProvider
    );
  t.context.providerCumulusId = pgProvider.cumulus_id;
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('Attempting to delete a provider without an Authorization header returns an Authorization Missing response', async (t) => {
  const { testPgProvider, providerPgModel } = t.context;

  const response = await request(app)
    .delete(`/providers/${testPgProvider.name}`)
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
  t.true(await providerPgModel.exists(t.context.testKnex, { name: testPgProvider.name }));
});

test('Attempting to delete a provider with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/providers/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('Attempting to delete a provider with an unauthorized user returns an unauthorized response');

test('Deleting a provider removes the provider from postgres', async (t) => {
  const { testPgProvider, providerPgModel } = t.context;
  const name = testPgProvider.name;
  await request(app)
    .delete(`/providers/${name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(await providerPgModel.exists(t.context.testKnex, { name }));
});

test('Deleting a provider that does not exist in PostgreSQL returns a 404', async (t) => {
  const { status } = await request(app)
    .delete(`/providers/${randomString}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);
  t.is(status, 404);
});

test('Attempting to delete a provider with an associated postgres rule returns a 409 response', async (t) => {
  const { testPgProvider } = t.context;

  const rule = fakeRuleRecordFactory({
    provider_cumulus_id: t.context.providerCumulusId,
  });

  await t.context.rulePgModel.create(
    t.context.testKnex,
    rule
  );

  const response = await request(app)
    .delete(`/providers/${testPgProvider.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.true(response.body.message.includes('Cannot delete provider with associated rules'));
});

test('Attempting to delete a provider with an associated granule does not delete the provider', async (t) => {
  const {
    collectionPgModel,
    granulePgModel,
    providerCumulusId,
    testKnex,
    testPgProvider,
  } = t.context;

  const collection = {
    name: randomString(),
    version: '001',
    sample_file_name: 'fake',
    granule_id_validation_regex: 'fake',
    granule_id_extraction_regex: 'fake',
    files: {},
  };

  const [pgCollection] = await collectionPgModel.create(
    t.context.testKnex,
    collection
  );
  const collectionCumulusId = pgCollection.cumulus_id;

  const pgGranule = fakeGranuleRecordFactory(
    {
      granule_id: randomId('granuleId'),
      status: 'completed',
      provider_cumulus_id: providerCumulusId,
      collection_cumulus_id: collectionCumulusId,
      published: false,
    }
  );

  await granulePgModel.create(testKnex, pgGranule);

  const response = await request(app)
    .delete(`/providers/${testPgProvider.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.is(response.body.message, `Cannot delete provider ${testPgProvider.name} with associated granules.`);
  t.true(await t.context.providerPgModel.exists(t.context.testKnex, { name: testPgProvider.name }));

  t.teardown(async () => {
    await granulePgModel.delete(testKnex, { granule_id: pgGranule.granule_id });
    await collectionPgModel.delete(testKnex, { cumulus_id: collectionCumulusId });
  });
});
