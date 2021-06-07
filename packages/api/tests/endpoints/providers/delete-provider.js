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
} = require('@cumulus/db/dist/test-utils');
const {
  destroyLocalTestDb,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  translateApiProviderToPostgresProvider,
  translateApiRuleToPostgresRule,
  CollectionPgModel,
  RulePgModel,
  ProviderPgModel,
} = require('@cumulus/db');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory,
  fakeGranuleFactoryV2,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');

const testDbName = randomString(12);

process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();
process.env = {
  ...process.env,
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

// import the express app after setting the env variables
const { app } = require('../../../app');
const { migrationDir } = require('../../../../../lambdas/db-migration');

const esIndex = randomString();
let esClient;
let providerModel;

let accessTokenModel;
let granuleModel;
let jwtAuthToken;
let ruleModel;

test.before(async (t) => {
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.rulePgModel = new RulePgModel();
  t.context.granulePgModel = new GranulePgModel();

  process.env.stackName = randomString();

  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  providerModel = new models.Provider();
  await providerModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  esClient = await Search.es('fakehost');

  process.env.RulesTable = randomString();
  ruleModel = new models.Rule();
  await ruleModel.createTable();

  process.env.GranulesTable = randomId('granules');
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflow_template.json`,
    Body: JSON.stringify({}),
  }).promise();
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderFactory();
  const createObject = await translateApiProviderToPostgresProvider(t.context.testProvider);
  [t.context.providerCumulusId] = await t.context.providerPgModel
    .create(
      t.context.testKnex,
      createObject
    );
  await providerModel.create(t.context.testProvider);
});

test.after.always(async (t) => {
  await providerModel.deleteTable();
  await accessTokenModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await ruleModel.deleteTable();
  await granuleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('Attempting to delete a provider without an Authorization header returns an Authorization Missing response', async (t) => {
  const { testProvider } = t.context;

  const response = await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
  t.true(await providerModel.exists(testProvider.id));
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

test('Deleting a provider removes the provider', async (t) => {
  const { testProvider } = t.context;
  const id = testProvider.id;
  await request(app)
    .delete(`/providers/${id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(await providerModel.exists(testProvider.id));
  t.false(await t.context.providerPgModel.exists(t.context.testKnex, { name: id }));
});

test('Deleting a provider that does not exist succeeds', async (t) => {
  const { status } = await request(app)
    .delete(`/providers/${randomString}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);
  t.is(status, 200);
});

test('Attempting to delete a provider with an associated postgres rule returns a 409 response', async (t) => {
  const { testProvider } = t.context;
  const rule = fakeRuleFactoryV2({
    provider: testProvider.id,
    rule: {
      type: 'onetime',
    },
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({}),
  }).promise();

  const collection = {
    name: randomString(10),
    version: '001',
    sample_file_name: 'fake',
    granule_id_validation_regex: 'fake',
    granule_id_extraction_regex: 'fake',
    files: {},
  };
  await t.context.collectionPgModel
    .create(
      t.context.testKnex,
      collection
    );

  await t.context.rulePgModel.create(
    t.context.testKnex,
    await translateApiRuleToPostgresRule(
      {
        ...rule,
        collection,
      },
      t.context.testKnex
    )
  );

  const response = await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.true(response.body.message.includes('Cannot delete provider with associated rules'));
});

test('Attempting to delete a provider with an associated rule returns a 409 response', async (t) => {
  const { testProvider } = t.context;

  const rule = fakeRuleFactoryV2({
    provider: testProvider.id,
    rule: {
      type: 'onetime',
    },
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({}),
  }).promise();

  await ruleModel.create(rule);

  const response = await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.is(response.body.message, `Cannot delete provider with associated rules: ${rule.name}`);
});

test('Attempting to delete a provider with an associated rule does not delete the provider', async (t) => {
  const { testProvider } = t.context;

  const rule = fakeRuleFactoryV2({
    provider: testProvider.id,
    rule: {
      type: 'onetime',
    },
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({}),
  }).promise();

  await ruleModel.create(rule);

  await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.true(await providerModel.exists(testProvider.id));
});

test('Attempting to delete a provider with an associated granule does not delete the provider', async (t) => {
  const {
    collectionPgModel,
    granulePgModel,
    providerCumulusId,
    testKnex,
    testProvider,
  } = t.context;

  const granuleId = randomString();

  const dynamoGranule = fakeGranuleFactoryV2(
    {
      granuleId: granuleId,
      status: 'completed',
      published: false,
      provider: testProvider.id,
    }
  );

  await granuleModel.create(dynamoGranule);

  const collection = {
    name: randomString(),
    version: '001',
    sample_file_name: 'fake',
    granule_id_validation_regex: 'fake',
    granule_id_extraction_regex: 'fake',
    files: {},
  };

  const [collectionCumulusId] = await collectionPgModel
    .create(
      t.context.testKnex,
      collection
    );

  const pgGranule = fakeGranuleRecordFactory(
    {
      granule_id: granuleId,
      status: 'completed',
      provider_cumulus_id: providerCumulusId,
      collection_cumulus_id: collectionCumulusId,
      published: false,
    }
  );

  await granulePgModel.create(testKnex, pgGranule);

  const response = await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.is(response.body.message, `Cannot delete provider ${testProvider.id} with associated granules.`);
  t.true(await providerModel.exists(testProvider.id));

  t.teardown(async () => {
    await granulePgModel.delete(testKnex, { granule_id: pgGranule.granule_id });
    await collectionPgModel.delete(testKnex, { cumulus_id: collectionCumulusId });
  });
});
