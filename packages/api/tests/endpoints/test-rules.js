'use strict';

const fs = require('fs-extra');
const omit = require('lodash/omit');
const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const { randomString, randomId } = require('@cumulus/common/test-utils');
const workflows = require('@cumulus/common/workflows');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  fakeRuleRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  ProviderPgModel,
  RulePgModel,
  translateApiCollectionToPostgresCollection,
  translateApiProviderToPostgresProvider,
  translateApiRuleToPostgresRuleRaw,
  translatePostgresRuleToApiRule,
} = require('@cumulus/db');
const awsServices = require('@cumulus/aws-client/services');
const S3 = require('@cumulus/aws-client/S3');
const { Search } = require('@cumulus/es-client/search');
const indexer = require('@cumulus/es-client/indexer');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { buildFakeExpressResponse } = require('./utils');
const {
  fakeCollectionFactory,
  fakeProviderFactory,
  fakeRuleFactoryV2,
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  createRuleTestRecords,
  createSqsQueues,
} = require('../../lib/testUtils');
const { post, put, del } = require('../../endpoints/rules');

const rulesHelpers = require('../../lib/rulesHelpers');
const AccessToken = require('../../models/access-tokens');
const assertions = require('../../lib/assertions');

[
  'AccessTokensTable',
  'CollectionsTable',
  'stackName',
  'system_bucket',
  'TOKEN_SECRET',
  'messageConsumer',
  'KinesisInboundEventLogger',
  // eslint-disable-next-line no-return-assign
].forEach((varName) => process.env[varName] = randomString());

const testDbName = randomString(12);

// import the express app after setting the env variables
const { app } = require('../../app');

const workflow = randomId('workflow-');

const setBuildPayloadStub = () => sinon.stub(rulesHelpers, 'buildPayload').resolves({});

let jwtAuthToken;
let accessTokenModel;
let buildPayloadStub;

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const messageConsumer = await awsServices.lambda().createFunction({
    Code: {
      ZipFile: fs.readFileSync(require.resolve('@cumulus/test-data/fake-lambdas/hello.zip')),
    },
    FunctionName: randomId('messageConsumer'),
    Role: randomId('role'),
    Handler: 'index.handler',
    Runtime: 'nodejs14.x',
  }).promise();
  process.env.messageConsumer = messageConsumer.FunctionName;

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esRulesClient = new Search(
    {},
    'rule',
    t.context.esIndex
  );
  process.env.ES_INDEX = esIndex;

  await S3.createBucket(process.env.system_bucket);

  buildPayloadStub = setBuildPayloadStub();

  t.context.rulePgModel = new RulePgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.providerPgModel = new ProviderPgModel();

  // Create PG Provider
  t.context.testPgProvider = fakeProviderRecordFactory();
  [t.context.pgProvider] = await t.context.providerPgModel.create(
    t.context.testKnex,
    t.context.testPgProvider,
    '*'
  );

  // Create PG Collection
  const collectionName = 'fakeCollection';
  const collectionVersion = 'v1';
  const testPgCollection = fakeCollectionRecordFactory({
    name: collectionName,
    version: collectionVersion,
  });
  t.context.collectionPgModel = new CollectionPgModel();
  [t.context.pgCollection] = await t.context.collectionPgModel.create(
    t.context.testKnex,
    testPgCollection,
    '*'
  );
  t.context.collectionId = constructCollectionId(collectionName, collectionVersion);

  t.context.testRule = fakeRuleFactoryV2({
    name: randomId('testRule'),
    workflow: workflow,
    rule: {
      type: 'onetime',
      arn: 'arn',
      value: 'value',
    },
    state: 'ENABLED',
    queueUrl: 'https://sqs.us-west-2.amazonaws.com/123456789012/queue_url',
    collection: {
      name: t.context.pgCollection.name,
      version: t.context.pgCollection.version,
    },
    provider: t.context.pgProvider.name,
  });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  const workflowFileKey = workflows.getWorkflowFileKey(process.env.stackName, workflow);
  const templateFile = workflows.templateKey(process.env.stackName);
  await Promise.all([
    S3.putJsonS3Object(
      process.env.system_bucket,
      workflowFileKey,
      {}
    ),
    S3.putJsonS3Object(
      process.env.system_bucket,
      templateFile,
      {}
    ),
  ]);
  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(t.context.testRule);
  t.context.collectionId = constructCollectionId(collectionName, collectionVersion);
  t.context.testPgRule = await translateApiRuleToPostgresRuleRaw(ruleWithTrigger, knex);
  await indexer.indexRule(esClient, ruleWithTrigger, t.context.esIndex);
  t.context.rulePgModel.create(knex, t.context.testPgRule);
});

test.beforeEach((t) => {
  const newRule = fakeRuleFactoryV2({
    workflow: workflow,
  });
  delete newRule.collection;
  delete newRule.provider;
  t.context.newRule = newRule;
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await S3.recursivelyDeleteS3Bucket(process.env.system_bucket);
  await cleanupTestIndex(t.context);

  buildPayloadStub.restore();
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
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
    .get(`/rules/${t.context.testRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const expectedRule = {
    ...t.context.testRule,
    updatedAt: response.body.updatedAt,
    createdAt: response.body.createdAt,
  };
  t.deepEqual(response.body, expectedRule);
});

test('When calling the API endpoint to delete an existing rule it does not return the deleted rule', async (t) => {
  const {
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
      queue_url: 'fake-queue-url',
    }
  );
  t.true(await t.context.rulePgModel.exists(t.context.testKnex, { name: originalPgRecord.name }));

  const response = await request(app)
    .delete(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message, record } = response.body;
  t.is(message, 'Record deleted');
  t.is(record, undefined);
  t.false(await t.context.rulePgModel.exists(t.context.testKnex, { name: originalPgRecord.name }));
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

test('POST creates a rule in all data stores', async (t) => {
  const {
    collectionPgModel,
    newRule,
    providerPgModel,
    rulePgModel,
    testKnex,
  } = t.context;

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

  newRule.rule = {
    type: 'kinesis',
    value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`,
  };

  await collectionPgModel.create(
    testKnex,
    translateApiCollectionToPostgresCollection(fakeCollection)
  );

  await providerPgModel.create(
    testKnex,
    await translateApiProviderToPostgresProvider(fakeProvider)
  );

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const { message } = response.body;
  const fetchedPostgresRecord = await rulePgModel
    .get(testKnex, { name: newRule.name });

  t.is(message, 'Record saved');
  const translatedPgRecord = await translatePostgresRuleToApiRule(fetchedPostgresRecord, testKnex);

  const esRecord = await t.context.esRulesClient.get(
    newRule.name
  );
  t.like(esRecord, translatedPgRecord);
});

test('POST creates a rule in PG with correct timestamps', async (t) => {
  const { newRule } = t.context;

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

  await t.context.collectionPgModel.create(
    t.context.testKnex,
    translateApiCollectionToPostgresCollection(fakeCollection)
  );
  await t.context.providerPgModel.create(
    t.context.testKnex,
    await translateApiProviderToPostgresProvider(fakeProvider)
  );

  await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const fetchedPostgresRecord = await t.context.rulePgModel
    .get(t.context.testKnex, { name: newRule.name });

  t.true(fetchedPostgresRecord.created_at.getTime() > newRule.createdAt);
  t.true(fetchedPostgresRecord.updated_at.getTime() > newRule.updatedAt);
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

  const fetchedPostgresRecord = await t.context.rulePgModel
    .get(t.context.testKnex, { name: newRule.name });

  t.true(fetchedPostgresRecord.enabled);
  t.is(response.body.record.state, 'ENABLED');
});

test('POST returns a 409 response if record already exists', async (t) => {
  const { newRule } = t.context;

  // create rule
  await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  // attempt to create duplicate rule
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
  const { message } = response.body;
  t.is(response.status, 400);
  t.true(message.includes('The record has validation errors. Rule workflow is undefined'));
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
  const { message } = response.body;
  t.is(response.status, 400);
  t.true(message.includes('Rule name may only contain letters, numbers, and underscores'));
});

test('POST returns a 400 response if rule name does not exist', async (t) => {
  const { newRule } = t.context;
  newRule.name = '';

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(400);
  const { message } = response.body;
  t.is(response.status, 400);
  t.true(message.includes('The record has validation errors. Rule name is undefined.'));
});

test('POST returns a 400 response if rule type is invalid', async (t) => {
  const { newRule } = t.context;
  newRule.rule.type = 'invalid';

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(400);
  const { message } = response.body;
  t.is(response.status, 400);
  t.true(message.includes('Rule type \'invalid\' not supported.'));
});

test.serial('POST returns a 500 response if workflow definition file does not exist', async (t) => {
  const rule = fakeRuleRecordFactory();
  const translatedRule = await translatePostgresRuleToApiRule(rule, t.context.knex);

  buildPayloadStub.restore();

  try {
    const response = await request(app)
      .post('/rules')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(translatedRule)
      .expect(500);
    t.is(response.status, 500);
  } finally {
    buildPayloadStub = setBuildPayloadStub();
  }
});

test.serial('POST returns a 500 response if record creation throws unexpected error', async (t) => {
  const { newRule } = t.context;

  const stub = sinon.stub(RulePgModel.prototype, 'create')
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

test.serial('post() does not write to Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const { newRule, testKnex } = t.context;

  const fakeRulePgModel = {
    create: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    body: newRule,
    testContext: {
      knex: testKnex,
      rulePgModel: fakeRulePgModel,
    },
  };
  const response = buildFakeExpressResponse();
  await post(expressRequest, response);

  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.false(await t.context.esRulesClient.exists(
    newRule.name
  ));
});

test.serial('post() does not write to PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { newRule, testKnex } = t.context;

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const expressRequest = {
    body: newRule,
    testContext: {
      knex: testKnex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.false(await t.context.esRulesClient.exists(
    newRule.name
  ));
});

test('PUT replaces a rule', async (t) => {
  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const {
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
    }
  );
  const translatedPgRecord = await translatePostgresRuleToApiRule(originalPgRecord, testKnex);

  const updateRule = {
    ...omit(translatedPgRecord, ['queueUrl', 'provider', 'collection']),
    state: 'ENABLED',
    // these timestamps should not get used
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await request(app)
    .put(`/rules/${updateRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(200);

  const actualPostgresRule = await rulePgModel.get(testKnex, { name: updateRule.name });
  const updatedEsRecord = await esRulesClient.get(translatedPgRecord.name);

  // PG and ES records have the same timestamps
  t.true(actualPostgresRule.updated_at > originalPgRecord.updated_at);
  t.is(actualPostgresRule.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPostgresRule.updated_at.getTime(), updatedEsRecord.updatedAt);
  t.deepEqual(
    updatedEsRecord,
    {
      ...originalEsRecord,
      state: 'ENABLED',
      createdAt: actualPostgresRule.created_at.getTime(),
      updatedAt: actualPostgresRule.updated_at.getTime(),
      timestamp: updatedEsRecord.timestamp,
    }
  );
  t.like(actualPostgresRule, {
    ...omit(originalPgRecord, ['queue_url']),
    enabled: true,
    created_at: new Date(originalPgRecord.created_at),
    updated_at: actualPostgresRule.updated_at,
  });
});

test.serial('put() sets SNS rule to "disabled" and removes source mapping ARN', async (t) => {
  const snsStub = sinon.stub(awsServices, 'sns')
    .returns({
      listSubscriptionsByTopic: () => ({
        promise: () => Promise.resolve({
          Subscriptions: [{
            Endpoint: process.env.messageConsumer,
            SubscriptionArn: randomString(),
          }],
        }),
      }),
      unsubscribe: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  const lambdaStub = sinon.stub(awsServices, 'lambda')
    .returns({
      addPermission: () => ({
        promise: () => Promise.resolve(),
      }),
      removePermission: () => ({
        promise: () => Promise.resolve(),
      }),
    });
  t.teardown(() => {
    snsStub.restore();
    lambdaStub.restore();
  });

  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const {
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      value: 'sns-arn',
      type: 'sns',
      enabled: true,
      workflow,
    }
  );

  t.truthy(originalPgRecord.arn);
  t.is(originalEsRecord.rule.arn, originalPgRecord.arn);

  const translatedPgRecord = await translatePostgresRuleToApiRule(originalPgRecord, testKnex);

  const updateRule = {
    ...translatedPgRecord,
    state: 'DISABLED',
  };

  await request(app)
    .put(`/rules/${updateRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(200);

  const updatedPostgresRule = await rulePgModel.get(testKnex, { name: updateRule.name });
  const updatedEsRecord = await esRulesClient.get(translatedPgRecord.name);

  t.is(updatedPostgresRule.arn, null);
  t.is(updatedEsRecord.rule.arn, undefined);
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
  t.true(message.includes(name));
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

    t.true(message.includes('Expected rule name to be'));
    t.falsy(record);
  });

test('PUT returns a 400 response if record is missing workflow property', async (t) => {
  const {
    originalApiRule,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
    }
  );

  // Set required property to null to trigger create error
  originalApiRule.workflow = null;

  const response = await request(app)
    .put(`/rules/${originalApiRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(originalApiRule)
    .expect(400);
  const { message } = response.body;
  t.true(message.includes('The record has validation errors. Rule workflow is undefined'));
});

test('PUT returns a 400 response if record is missing type property', async (t) => {
  const {
    originalApiRule,
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
    }
  );
  originalApiRule.rule.type = null;
  const response = await request(app)
    .put(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(originalApiRule)
    .expect(400);
  const { message } = response.body;
  t.true(message.includes('The record has validation errors. Rule type is undefined.'));
});

test('PUT returns a 400 response if rule name is invalid', async (t) => {
  const {
    originalApiRule,
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
    }
  );
  originalApiRule.name = 'bad rule name';
  const response = await request(app)
    .put(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(originalApiRule)
    .expect(400);
  const { message } = response.body;
  t.true(message.includes(originalApiRule.name));
});

test('PUT returns a 400 response if rule type is invalid', async (t) => {
  const {
    originalApiRule,
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
    }
  );
  originalApiRule.rule.type = 'invalid';

  const response = await request(app)
    .put(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(originalApiRule)
    .expect(400);

  const { message } = response.body;
  t.true(message.includes('Rule type \'invalid\' not supported.'));
});

test('put() does not write to Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalApiRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'queue-1',
      workflow,
    }
  );

  const fakerulePgModel = {
    get: () => Promise.resolve(originalPgRecord),
    upsert: () => Promise.reject(new Error('something bad')),
  };

  const updatedRule = {
    ...originalApiRule,
    queueUrl: 'queue-2',
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    body: updatedRule,
    testContext: {
      knex: testKnex,
      rulePgModel: fakerulePgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.rulePgModel.get(t.context.testKnex, {
      name: originalPgRecord.name,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esRulesClient.get(
      originalPgRecord.name
    ),
    originalEsRecord
  );
});

test('put() does not write to PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalApiRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'queue-1',
      workflow,
    }
  );

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const updatedRule = {
    ...originalApiRule,
    queueUrl: 'queue-2',
  };

  const expressRequest = {
    params: {
      name: originalApiRule.name,
    },
    body: updatedRule,
    testContext: {
      knex: testKnex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.rulePgModel.get(t.context.testKnex, {
      name: originalApiRule.name,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esRulesClient.get(
      originalApiRule.name
    ),
    originalEsRecord
  );
});

test.serial('put() creates the same updated SNS rule in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();
  const topic2 = await awsServices.sns().createTopic({ Name: randomId('topic2_') }).promise();

  const {
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
      queueUrl: 'fake-queue-url',
      state: 'ENABLED',
      type: 'sns',
      value: topic1.TopicArn,
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalEsRecord.rule.value);
  t.truthy(originalPgRecord.value);
  const updateRule = {
    ...originalPgRecord,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    body: updateRule,
  };
  const response = buildFakeExpressResponse();
  await put(expressRequest, response);
  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalPgRecord.name
  );

  t.truthy(updatedEsRule.rule.value);
  t.truthy(updatedPgRule.value);

  t.not(updatedEsRule.rule.value, originalEsRecord.rule.value);
  t.not(updatedPgRule.value, originalPgRecord.value);

  t.deepEqual(
    updatedEsRule,
    {
      ...originalEsRecord,
      updatedAt: updatedEsRule.updatedAt,
      timestamp: updatedEsRule.timestamp,
      rule: {
        type: 'sns',
        value: topic2.TopicArn,
      },
    }
  );
  t.deepEqual(updatedPgRule, {
    ...originalPgRecord,
    updated_at: updatedPgRule.updated_at,
    type: 'sns',
    arn: updatedPgRule.arn,
    value: topic2.TopicArn,
  });
});

test.serial('put() creates the same updated Kinesis rule in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const kinesisArn1 = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis1_')}`;
  const kinesisArn2 = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis2_')}`;

  const {
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
      state: 'ENABLED',
      type: 'kinesis',
      value: kinesisArn1,
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalEsRecord.rule.arn);
  t.truthy(originalEsRecord.rule.logEventArn);
  t.truthy(originalPgRecord.arn);
  t.truthy(originalPgRecord.log_event_arn);

  const updateRule = {
    ...originalPgRecord,
    rule: {
      type: 'kinesis',
      value: kinesisArn2,
    },
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    body: updateRule,
  };

  const response = buildFakeExpressResponse();

  await put(expressRequest, response);

  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalPgRecord.name
  );

  t.truthy(updatedEsRule.rule.arn);
  t.truthy(updatedEsRule.rule.logEventArn);
  t.truthy(updatedPgRule.arn);
  t.truthy(updatedPgRule.log_event_arn);

  t.not(originalEsRecord.rule.arn, updatedEsRule.rule.arn);
  t.not(originalEsRecord.rule.logEventArn, updatedEsRule.rule.logEventArn);
  t.not(originalPgRecord.arn, updatedPgRule.arn);
  t.not(originalPgRecord.log_event_arn, updatedPgRule.log_event_arn);

  t.deepEqual(
    updatedEsRule,
    {
      ...originalEsRecord,
      updatedAt: updatedEsRule.updatedAt,
      timestamp: updatedEsRule.timestamp,
      rule: {
        arn: updatedEsRule.rule.arn,
        logEventArn: updatedEsRule.rule.logEventArn,
        type: 'kinesis',
        value: kinesisArn2,
      },
    }
  );
  t.deepEqual(updatedPgRule, {
    ...originalPgRecord,
    updated_at: updatedPgRule.updated_at,
    type: 'kinesis',
    value: kinesisArn2,
    arn: updatedPgRule.arn,
    log_event_arn: updatedPgRule.log_event_arn,
  });
});

test.serial('put() creates the same SQS rule in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const queue1 = randomId('queue');
  const queue2 = randomId('queue');

  const { queueUrl: queueUrl1 } = await createSqsQueues(queue1);
  const { queueUrl: queueUrl2 } = await createSqsQueues(queue2);

  const {
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    {
      ...t.context,
    },
    {
      workflow,
      name: randomId('rule'),
      state: 'ENABLED',
      type: 'sqs',
      value: queueUrl1,
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  const expectedMeta = {
    visibilityTimeout: 300,
    retries: 3,
  };
  console.log(`originalPgRecord: ${JSON.stringify(originalPgRecord)}`);
  console.log(`originalEsRecord: ${JSON.stringify(originalEsRecord)}`);
  t.deepEqual(originalPgRecord.meta, expectedMeta);
  t.deepEqual(originalEsRecord.meta, expectedMeta);

  const updateRule = {
    ...originalPgRecord,
    rule: {
      type: 'sqs',
      value: queueUrl2,
    },
  };
  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    body: updateRule,
  };
  const response = buildFakeExpressResponse();
  await put(expressRequest, response);

  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    updateRule.name
  );

  t.deepEqual(
    updatedEsRule,
    {
      ...originalEsRecord,
      updatedAt: updatedEsRule.updatedAt,
      timestamp: updatedEsRule.timestamp,
      rule: {
        type: 'sqs',
        value: queueUrl2,
      },
    }
  );
  t.deepEqual(updatedPgRule, {
    ...originalPgRecord,
    updated_at: updatedPgRule.updated_at,
    type: 'sqs',
    value: queueUrl2,
  });
});

test.serial('put() keeps initial trigger information if writing to PostgreSQL fails', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();
  const topic2 = await awsServices.sns().createTopic({ Name: randomId('topic2_') }).promise();

  const deleteOldEventSourceMappingsSpy = sinon.spy(rulesHelpers, 'deleteOldEventSourceMappings');
  t.teardown(() => {
    deleteOldEventSourceMappingsSpy.restore();
  });

  const {
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    {
      ...t.context,
    },
    {
      workflow,
      state: 'ENABLED',
      type: 'sns',
      value: topic1.TopicArn,
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalEsRecord.rule.value);
  t.truthy(originalPgRecord.value);

  const updateRule = {
    ...originalPgRecord,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    body: updateRule,
    testContext: {
      rulePgModel: {
        get: () => Promise.resolve(originalPgRecord),
        upsert: () => {
          throw new Error('PG fail');
        },
      },
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'PG fail' }
  );

  t.false(deleteOldEventSourceMappingsSpy.called);

  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalPgRecord.name
  );

  t.is(updatedEsRule.rule.arn, originalEsRecord.rule.arn);
  t.is(updatedPgRule.arn, originalPgRecord.arn);

  t.like(
    updatedEsRule,
    {
      ...originalEsRecord,
      updatedAt: updatedEsRule.updatedAt,
      timestamp: updatedEsRule.timestamp,
      rule: {
        type: 'sns',
        value: topic1.TopicArn,
      },
    }
  );
  t.like(updatedPgRule, {
    ...originalPgRecord,
    updated_at: updatedPgRule.updated_at,
    type: 'sns',
    value: topic1.TopicArn,
  });
});

test.serial('put() keeps initial trigger information if writing to Elasticsearch fails', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();
  const topic2 = await awsServices.sns().createTopic({ Name: randomId('topic2_') }).promise();

  const deleteOldEventSourceMappingsSpy = sinon.spy(rulesHelpers, 'deleteOldEventSourceMappings');
  t.teardown(() => {
    deleteOldEventSourceMappingsSpy.restore();
  });

  const {
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    {
      ...t.context,
    },
    {
      workflow,
      state: 'ENABLED',
      type: 'sns',
      value: topic1.TopicArn,
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalEsRecord.rule.value);
  t.truthy(originalPgRecord.value);

  const updateRule = {
    ...originalPgRecord,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    body: updateRule,
    testContext: {
      esClient: {
        index: () => {
          throw new Error('ES fail');
        },
      },
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'ES fail' }
  );

  t.false(deleteOldEventSourceMappingsSpy.called);

  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalPgRecord.name
  );

  t.is(updatedEsRule.rule.arn, originalEsRecord.rule.arn);
  t.is(updatedPgRule.arn, originalPgRecord.arn);

  t.like(
    updatedEsRule,
    {
      ...originalEsRecord,
      updatedAt: updatedEsRule.updatedAt,
      timestamp: updatedEsRule.timestamp,
      rule: {
        type: 'sns',
        value: topic1.TopicArn,
      },
    }
  );
  t.like(updatedPgRule, {
    ...originalPgRecord,
    updated_at: updatedPgRule.updated_at,
    type: 'sns',
    value: topic1.TopicArn,
  });
});

test('DELETE returns a 404 if PostgreSQL and Elasticsearch rule cannot be found', async (t) => {
  const nonExistentRule = fakeRuleRecordFactory();
  const response = await request(app)
    .delete(`/rules/${nonExistentRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, 'No record found');
});

test('DELETE deletes rule that exists in PostgreSQL but not Elasticsearch', async (t) => {
  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const newRule = fakeRuleRecordFactory();
  delete newRule.collection;
  delete newRule.provider;
  await rulePgModel.create(testKnex, newRule);

  t.false(
    await esRulesClient.exists(
      newRule.name
    )
  );
  t.true(
    await rulePgModel.exists(testKnex, {
      name: newRule.name,
    })
  );
  const response = await request(app)
    .delete(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { message } = response.body;
  const dbRecords = await rulePgModel
    .search(testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.is(message, 'Record deleted');
});

test('DELETE deletes rule that exists in Elasticsearch but not PostgreSQL', async (t) => {
  const {
    esClient,
    esIndex,
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const newRule = fakeRuleRecordFactory();
  await indexer.indexRule(esClient, newRule, esIndex);

  t.true(
    await esRulesClient.exists(
      newRule.name
    )
  );
  t.false(
    await rulePgModel.exists(testKnex, {
      name: newRule.name,
    })
  );
  const response = await request(app)
    .delete(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { message } = response.body;
  const dbRecords = await rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.is(message, 'Record deleted');
});

test('DELETE deletes a rule', async (t) => {
  const {
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
    }
  );
  t.true(await t.context.rulePgModel.exists(t.context.testKnex, { name: originalPgRecord.name }));

  const response = await request(app)
    .delete(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message } = response.body;
  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: originalPgRecord.name });

  t.is(dbRecords.length, 0);
  t.is(message, 'Record deleted');
  t.false(
    await t.context.esRulesClient.exists(
      originalPgRecord.name
    )
  );
});

test('DELETE deletes only a Rule\'s resources if onlyResources queryparam is true', async (t) => {
  const {
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
    }
  );
  t.true(await t.context.rulePgModel.exists(t.context.testKnex, { name: originalPgRecord.name }));

  const response = await request(app)
    .delete(`/rules/${originalPgRecord.name}?onlyResources=true`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message } = response.body;

  t.true(await t.context.rulePgModel.exists(t.context.testKnex, { name: originalPgRecord.name }));
  t.is(message, 'Record resources (e.g. CloudWatch Events, Kinesis Event Sources) deleted');
});

test('del() does not remove from Elasticsearch if removing from PostgreSQL fails', async (t) => {
  const {
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
    }
  );

  const fakeRulesPgModel = {
    delete: () => {
      throw new Error('something bad');
    },
    get: () => Promise.resolve(originalPgRecord),
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    testContext: {
      knex: t.context.testKnex,
      rulePgModel: fakeRulesPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.true(
    await t.context.rulePgModel.exists(t.context.testKnex, {
      name: originalPgRecord.name,
    })
  );
  t.true(
    await t.context.esRulesClient.exists(
      originalPgRecord.name
    )
  );
});

test('del() does not remove from PostgreSQL if removing from Elasticsearch fails', async (t) => {
  const {
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
    }
  );

  const fakeEsClient = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    testContext: {
      knex: t.context.testKnex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.true(
    await t.context.rulePgModel.exists(t.context.testKnex, {
      name: originalPgRecord.name,
    })
  );
  t.true(
    await t.context.esRulesClient.exists(
      originalPgRecord.name
    )
  );
});

test.serial('Multiple rules using same SNS topic can be created and deleted', async (t) => {
  const {
    collectionPgModel,
    providerPgModel,
    testKnex,
  } = t.context;
  const testPgProvider = fakeProviderRecordFactory();
  await providerPgModel.create(
    testKnex,
    testPgProvider,
    '*'
  );

  const testPgCollection1 = fakeCollectionRecordFactory({
    name: randomId(),
    version: 'v1',
  });
  const testPgCollection2 = fakeCollectionRecordFactory({
    name: randomId(),
    version: 'v2',
  });
  await Promise.all([
    collectionPgModel.create(
      testKnex,
      testPgCollection1,
      '*'
    ),
    collectionPgModel.create(
      testKnex,
      testPgCollection2,
      '*'
    ),
  ]);
  const unsubscribeSpy = sinon.spy(awsServices.sns(), 'unsubscribe');
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: randomId('topic'),
  }).promise();

  const ruleWithTrigger = await rulesHelpers.createRuleTrigger(fakeRuleFactoryV2({
    name: randomId('rule1'),
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
    collection: {
      name: testPgCollection1.name,
      version: testPgCollection1.version,
    },
    provider: testPgProvider.name,
  }));
  const ruleWithTrigger2 = await rulesHelpers.createRuleTrigger(fakeRuleFactoryV2({
    name: randomId('rule2'),
    rule: {
      type: 'sns',
      value: TopicArn,
    },
    workflow,
    state: 'ENABLED',
    collection: {
      name: testPgCollection2.name,
      version: testPgCollection2.version,
    },
    provider: testPgProvider.name,
  }));
  await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(ruleWithTrigger)
    .expect(200);

  await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(ruleWithTrigger2)
    .expect(200);

  // rules share the same subscription
  t.is(ruleWithTrigger.rule.arn, ruleWithTrigger2.rule.arn);

  // Have to delete rules serially otherwise all rules still exist
  // when logic to check for shared source mapping is evaluated
  await request(app)
    .delete(`/rules/${ruleWithTrigger.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  await t.notThrowsAsync(
    request(app)
      .delete(`/rules/${ruleWithTrigger2.name}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .expect(200)
  );
  // Ensure that cleanup for SNS rule subscription was actually called
  t.true(unsubscribeSpy.called);
  t.true(unsubscribeSpy.calledWith({
    SubscriptionArn: ruleWithTrigger.rule.arn,
  }));

  t.teardown(async () => {
    unsubscribeSpy.restore();
    await awsServices.sns().deleteTopic({
      TopicArn,
    });
  });
});
