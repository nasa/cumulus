'use strict';

const omit = require('lodash/omit');
const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  getKnexClient,
  localStackConnectionEnv,
  tableNames,
} = require('@cumulus/db');
const { translateApiRuleToPostgresRule } = require('@cumulus/db');
const S3 = require('@cumulus/aws-client/S3');

const { buildFakeExpressResponse } = require('./utils');
const { fakeCollectionFactory, fakeProviderFactory } = require('../../lib/testUtils');
const { post } = require('../../endpoints/rules');
const bootstrap = require('../../lambdas/bootstrap');
const AccessToken = require('../../models/access-tokens');
const Rule = require('../../models/rules');

const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  fakeRuleFactoryV2,
} = require('../../lib/testUtils');
const { Search } = require('../../es/search');
const indexer = require('../../es/indexer');
const assertions = require('../../lib/assertions');

[
  'AccessTokensTable',
  'RulesTable',
  'CollectionsTable',
  'ProvidersTable',
  'stackName',
  'system_bucket',
  'TOKEN_SECRET',
  // eslint-disable-next-line no-return-assign
].forEach((varName) => process.env[varName] = randomString());

// import the express app after setting the env variables
const { app } = require('../../app');

const esIndex = randomString();
const workflow = randomId('workflow-');
const testRule = {
  name: randomId('testRule'),
  workflow: workflow,
  rule: {
    type: 'onetime',
    arn: 'arn',
    value: 'value',
  },
  state: 'ENABLED',
  queueUrl: 'queue_url',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const dynamoRuleOmitList = ['createdAt', 'updatedAt', 'state', 'provider', 'collection', 'rule', 'queueUrl', 'executionNamePrefix'];

const setBuildPayloadStub = () => sinon.stub(Rule, 'buildPayload').resolves({});

let esClient;
let jwtAuthToken;
let accessTokenModel;
let ruleModel;
let buildPayloadStub;

test.before(async (t) => {
  process.env = { ...process.env, ...localStackConnectionEnv };

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  esClient = await Search.es('fakehost');
  await S3.createBucket(process.env.system_bucket);

  buildPayloadStub = setBuildPayloadStub();

  ruleModel = new Rule();
  await ruleModel.createTable();

  const ruleRecord = await ruleModel.create(testRule, testRule.createdAt);
  await indexer.indexRule(esClient, ruleRecord, esAlias);

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  esClient = await Search.es('fakehost');

  t.context.dbClient = await getKnexClient({ env: localStackConnectionEnv });
});

test.beforeEach(async (t) => {
  const newRule = fakeRuleFactoryV2();
  newRule.createdAt = Date.now();
  newRule.updatedAt = Date.now();
  delete newRule.collection;
  delete newRule.provider;

  t.context.newRule = newRule;
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await ruleModel.deleteTable();
  await S3.recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });

  await t.context.dbClient.destroy();
  buildPayloadStub.restore();
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/rules')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 POST with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .post('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .put('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .delete('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('CUMULUS-912 GET with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 POST with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .post('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 POST with pathParameters and with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 DELETE with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 DELETE with pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('default returns list of rules', async (t) => {
  const response = await request(app)
    .get('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
});

test('GET gets a rule', async (t) => {
  const response = await request(app)
    .get(`/rules/${testRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { name } = response.body;
  t.is(name, testRule.name);
});

test('When calling the API endpoint to delete an existing rule it does not return the deleted rule', async (t) => {
  const { newRule } = t.context;

  let response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  t.is(response.body.message, 'Record saved');

  response = await request(app)
    .delete(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const fetchedPostgresRecord = await t.context.dbClient.queryBuilder()
    .select()
    .table(tableNames.rules)
    .where({ name: newRule.name })
    .first();

  const { message, record } = response.body;
  t.is(message, 'Record deleted');
  t.is(record, undefined);
  t.is(fetchedPostgresRecord, undefined);
});

test('403 error when calling the API endpoint to delete an existing rule without a valid access token', async (t) => {
  const { newRule } = t.context;

  let response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const { message, record } = response.body;

  t.is(message, 'Record saved');
  newRule.createdAt = record.createdAt;
  newRule.updatedAt = record.updatedAt;

  response = await request(app)
    .delete(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);

  response = await request(app)
    .get(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.deepEqual(response.body, record);
});

test('POST creates a rule', async (t) => {
  const { dbClient, newRule } = t.context;

  const fakeCollection = fakeCollectionFactory();
  const fakeProvider = fakeProviderFactory({
    encrypted: true,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: new Date(2020, 11, 17),
    updatedAt: new Date(2020, 12, 2),
  });

  newRule.provider = fakeProvider.id;
  newRule.collection = {
    name: fakeCollection.name,
    version: fakeCollection.version,
  };

  const collectionRecord = {
    name: fakeCollection.name,
    version: fakeCollection.version,
    duplicate_handling: fakeCollection.duplicateHandling,
    granule_id_validation_regex: fakeCollection.granuleId,
    granule_id_extraction_regex: fakeCollection.granuleIdExtraction,
    files: (JSON.stringify(fakeCollection.files)),
    report_to_ems: fakeCollection.reportToEms,
    sample_file_name: fakeCollection.sampleFileName,
    created_at: new Date(fakeCollection.createdAt),
    updated_at: new Date(fakeCollection.updatedAt),
  };
  const providerRecord = {
    created_at: fakeProvider.createdAt,
    updated_at: fakeProvider.updatedAt,
    name: fakeProvider.id,
    cm_key_id: fakeProvider.cmKeyId,
    certificate_uri: fakeProvider.certificateUri,
    private_key: fakeProvider.privateKey,
    host: fakeProvider.host,
    port: fakeProvider.port,
  };

  const [collectionCumulusId] = await dbClient(tableNames.collections).insert(collectionRecord).returning('cumulus_id');
  const [providerCumulusId] = await dbClient(tableNames.providers).insert(providerRecord).returning('cumulus_id');

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const { message } = response.body;
  const fetchedDynamoRecord = await ruleModel.get({
    name: newRule.name,
  });

  const fetchedPostgresRecord = await t.context.dbClient.queryBuilder()
    .select()
    .table(tableNames.rules)
    .where({ name: newRule.name })
    .first();

  t.is(message, 'Record saved');

  t.deepEqual(
    omit(fetchedPostgresRecord, ['cumulus_id', 'created_at', 'updated_at']),
    omit(
      {
        ...fetchedDynamoRecord,
        collection_cumulus_id: collectionCumulusId,
        provider_cumulus_id: providerCumulusId,
        arn: null,
        value: null,
        type: newRule.rule.type,
        enabled: false,
        log_event_arn: null,
        execution_name_prefix: null,
        payload: null,
        queue_url: null,
        meta: null,
        tags: null,
      },
      dynamoRuleOmitList
    )
  );

  t.is(fetchedPostgresRecord.created_at.getTime(), fetchedDynamoRecord.createdAt);
});

test('POST creates a rule that is enabled by default', async (t) => {
  const { newRule } = t.context;
  delete newRule.state;

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const fetchedPostgresRecord = await t.context.dbClient.queryBuilder()
    .select()
    .table(tableNames.rules)
    .where({ name: newRule.name })
    .first();

  t.true(fetchedPostgresRecord.enabled);
  t.is(response.body.record.state, 'ENABLED');
});

test('POST returns a 409 response if record already exists', async (t) => {
  const { newRule } = t.context;

  await ruleModel.create(newRule);

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(409);

  const { message, record } = response.body;
  t.is(message, `A record already exists for ${newRule.name}`);
  t.falsy(record);
});

test('POST returns a 400 response if record is missing a required property', async (t) => {
  const { newRule } = t.context;

  // Remove required property to trigger create error
  delete newRule.workflow;

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(400);
  t.is(response.status, 400);
});

test('POST returns a 400 response if rule name is invalid', async (t) => {
  const { newRule } = t.context;
  newRule.name = 'bad rule name';

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(400);
  t.is(response.status, 400);
});

test('POST returns a 400 response if rule type is invalid', async (t) => {
  const { newRule } = t.context;
  newRule.type = 'invalid';

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(400);
  t.is(response.status, 400);
});

test.serial('POST returns a 500 response if workflow definition file does not exist', async (t) => {
  const { newRule } = t.context;
  buildPayloadStub.restore();

  try {
    const response = await request(app)
      .post('/rules')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(newRule)
      .expect(500);
    t.is(response.status, 500);
  } finally {
    buildPayloadStub = setBuildPayloadStub();
  }
});

test.serial('POST returns a 500 response if record creation throws unexpected error', async (t) => {
  const { newRule } = t.context;

  const stub = sinon.stub(Rule.prototype, 'create')
    .callsFake(() => {
      throw new Error('unexpected error');
    });

  try {
    const response = await request(app)
      .post('/rules')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(newRule)
      .expect(500);
    t.is(response.status, 500);
  } finally {
    stub.restore();
  }
});

test.serial('POST does not write to RDS or DynamoDB if writing to RDS fails', async (t) => {
  const { newRule, dbClient } = t.context;

  const failingTrx = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('Insert Rule Error');
      },
    });
    return cb(fakeTrx);
  };

  const trxStub = sinon.stub(dbClient, 'transaction').callsFake(failingTrx);
  t.teardown(() => trxStub.restore());

  const expressRequest = {
    body: newRule,
    testContext: {
      dbClient,
    },
  };
  const response = buildFakeExpressResponse();
  await post(expressRequest, response);

  const dbRecords = await dbClient.select()
    .from(tableNames.rules)
    .where({ name: newRule.name });

  t.true(response.boom.badImplementation.calledWithMatch('Insert Rule Error'));
  t.false(await ruleModel.exists(newRule.name));
  t.is(dbRecords.length, 0);
});

test.serial('POST does not write to DynamoDB or RDS if writing to DynamoDB fails', async (t) => {
  const { newRule, dbClient } = t.context;

  const failingRulesModel = {
    exists: () => false,
    create: () => {
      throw new Error('Rule error');
    },
  };

  const expressRequest = {
    body: newRule,
    testContext: {
      dbClient,
      model: failingRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  t.true(response.boom.badImplementation.calledWithMatch('Rule error'));

  const dbRecords = await dbClient.select()
    .from(tableNames.rules)
    .where({ name: newRule.name });

  t.is(dbRecords.length, 0);
  t.false(await ruleModel.exists(newRule.name));
});

test('PUT replaces a rule', async (t) => {
  const { dbClient } = t.context;
  const expectedRule = {
    ...omit(testRule, ['queueUrl', 'provider', 'collection']),
    state: 'ENABLED',
  };

  const translatedRule = await translateApiRuleToPostgresRule(testRule, dbClient);
  await dbClient(tableNames.rules).insert(translatedRule);

  const dbRecord = await dbClient.select()
    .from(tableNames.rules)
    .where({ name: expectedRule.name })
    .first();

  // Make sure testRule contains values for the properties we omitted from
  // expectedRule to confirm that after we replace (PUT) the rule those
  // properties are dropped from the stored rule.
  t.truthy(testRule.queueUrl);

  // Ensure pg record for test rule contains queue_url
  t.truthy(dbRecord.queue_url);

  await request(app)
    .put(`/rules/${testRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(expectedRule)
    .expect(200);

  const { body: actualRule } = await request(app)
    .get(`/rules/${testRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const dbRecords = await dbClient.select()
    .from(tableNames.rules)
    .where({ name: expectedRule.name })
    .first();

  t.is(dbRecords.queue_url, null);
  t.deepEqual(actualRule, {
    ...expectedRule,
    createdAt: actualRule.createdAt,
    updatedAt: actualRule.updatedAt,
  });
});

test('PUT returns 404 for non-existent rule', async (t) => {
  const name = 'new_make_coffee';
  const response = await request(app)
    .put(`/rules/${name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ name })
    .expect(404);

  const { message, record } = response.body;
  t.truthy(message.includes(name));
  t.falsy(record);
});

test('PUT returns 400 for name mismatch between params and payload',
  async (t) => {
    const response = await request(app)
      .put(`/rules/${randomString()}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ name: randomString() })
      .expect(400);
    const { message, record } = response.body;

    t.truthy(message);
    t.falsy(record);
  });

test('DELETE deletes a rule', async (t) => {
  const { dbClient, newRule } = t.context;

  await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const response = await request(app)
    .delete(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message } = response.body;
  const dbRecords = await dbClient.select()
    .from(tableNames.rules)
    .where({ name: newRule.name });

  t.is(dbRecords.length, 0);
  t.is(message, 'Record deleted');
});
