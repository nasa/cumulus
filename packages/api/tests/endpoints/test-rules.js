'use strict';

const fs = require('fs-extra');
const omit = require('lodash/omit');
const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  ProviderPgModel,
  RulePgModel,
  translateApiCollectionToPostgresCollection,
  translateApiProviderToPostgresProvider,
  translateApiRuleToPostgresRule,
} = require('@cumulus/db');
const S3 = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
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
} = require('../../lib/testUtils');
const { post, put, del } = require('../../endpoints/rules');

const AccessToken = require('../../models/access-tokens');
const Rule = require('../../models/rules');
const assertions = require('../../lib/assertions');

[
  'AccessTokensTable',
  'RulesTable',
  'CollectionsTable',
  'ProvidersTable',
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

const dynamoRuleOmitList = ['createdAt', 'updatedAt', 'state', 'provider', 'collection', 'rule', 'queueUrl', 'executionNamePrefix'];

const setBuildPayloadStub = () => sinon.stub(Rule, 'buildPayload').resolves({});

let jwtAuthToken;
let accessTokenModel;
let ruleModel;
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
  t.context.collectionId = constructCollectionId(collectionName, collectionVersion);

  ruleModel = new Rule();
  await ruleModel.createTable();
  t.context.ruleModel = ruleModel;

  const ruleWithTrigger = await ruleModel.createRuleTrigger(t.context.testRule);
  const ruleRecord = await ruleModel.create(ruleWithTrigger);
  await indexer.indexRule(esClient, ruleRecord, t.context.esIndex);
  t.context.testPgRule = await translateApiRuleToPostgresRule(ruleRecord, knex);
  t.context.rulePgModel.create(knex, t.context.testPgRule);

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.beforeEach((t) => {
  const newRule = fakeRuleFactoryV2();
  delete newRule.collection;
  delete newRule.provider;
  t.context.newRule = newRule;
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await ruleModel.deleteTable();
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

test.serial('search returns correct list of rules', async (t) => {
  const response = await request(app)
    .get('/rules?page=1&rule.type=onetime&state=ENABLED')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);

  const newResponse = await request(app)
    .get('/rules?page=1&rule.type=sqs&state=ENABLED')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results: newResults } = newResponse.body;
  t.is(newResults.length, 0);
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

  const { message, record } = response.body;
  t.is(message, 'Record deleted');
  t.is(record, undefined);
  t.false(await t.context.rulePgModel.exists(t.context.testKnex, { name: newRule.name }));
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

  newRule.rule = {
    type: 'kinesis',
    value: `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis')}`,
  };

  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.testKnex,
    translateApiCollectionToPostgresCollection(fakeCollection)
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  const collectionCumulusId = t.context.collectionCumulusId;

  const [pgProvider] = await t.context.providerPgModel.create(
    t.context.testKnex,
    await translateApiProviderToPostgresProvider(fakeProvider)
  );

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

  const fetchedPostgresRecord = await t.context.rulePgModel
    .get(t.context.testKnex, { name: newRule.name });

  t.is(message, 'Record saved');

  t.deepEqual(
    omit(fetchedPostgresRecord, ['cumulus_id', 'created_at', 'updated_at']),
    omit(
      {
        ...fetchedDynamoRecord,
        collection_cumulus_id: collectionCumulusId,
        provider_cumulus_id: pgProvider.cumulus_id,
        arn: fetchedDynamoRecord.rule.arn,
        value: fetchedDynamoRecord.rule.value,
        type: fetchedDynamoRecord.rule.type,
        enabled: false,
        log_event_arn: fetchedDynamoRecord.rule.logEventArn,
        execution_name_prefix: null,
        payload: null,
        queue_url: null,
        meta: null,
        tags: null,
      },
      dynamoRuleOmitList
    )
  );

  const esRecord = await t.context.esRulesClient.get(
    newRule.name
  );
  t.like(esRecord, fetchedDynamoRecord);
});

test.serial('post() creates SNS rule with same trigger information in Dynamo/PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();

  const rule = fakeRuleFactoryV2({
    state: 'ENABLED',
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
    },
    collection: {
      name: pgCollection.name,
      version: pgCollection.version,
    },
    provider: pgProvider.name,
  });

  const expressRequest = {
    body: rule,
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  t.true(response.send.called);

  const dynamoRule = await ruleModel.get({ name: rule.name });
  const pgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: rule.name });
  const esRule = await t.context.esRulesClient.get(
    rule.name
  );

  t.truthy(dynamoRule.rule.arn);
  t.truthy(pgRule.arn);
  t.truthy(esRule.rule.arn);

  t.like(dynamoRule, {
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
      arn: dynamoRule.rule.arn,
    },
  });
  t.like(
    esRule,
    {
      rule: {
        type: 'sns',
        value: topic1.TopicArn,
        arn: dynamoRule.rule.arn,
      },
    }
  );
  t.like(pgRule, {
    name: rule.name,
    enabled: true,
    type: 'sns',
    arn: dynamoRule.rule.arn,
    value: topic1.TopicArn,
  });
});

test.serial('post() creates the same Kinesis rule with trigger information in Dynamo/PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const kinesisArn1 = randomId('kinesis');
  const fakeKinesisSources1 = {
    arn: randomId('arn'),
    logEventArn: randomId('log'),
  };

  const addKinesisSourcesStub = sinon.stub(Rule.prototype, 'addKinesisEventSources')
    .resolves(fakeKinesisSources1);
  t.teardown(() => {
    addKinesisSourcesStub.restore();
  });

  const stubbedRulesModel = new Rule();

  const rule = fakeRuleFactoryV2({
    state: 'ENABLED',
    rule: {
      type: 'kinesis',
      value: kinesisArn1,
    },
    collection: {
      name: pgCollection.name,
      version: pgCollection.version,
    },
    provider: pgProvider.name,
  });

  const expressRequest = {
    body: rule,
    testContext: {
      ruleModel: stubbedRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  const dynamoRule = await ruleModel.get({ name: rule.name });
  const pgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: rule.name });
  const esRule = await t.context.esRulesClient.get(
    rule.name
  );

  t.like(dynamoRule, {
    rule: {
      ...fakeKinesisSources1,
      type: 'kinesis',
      value: kinesisArn1,
    },
  });
  t.like(
    esRule,
    {
      rule: {
        ...fakeKinesisSources1,
        type: 'kinesis',
        value: kinesisArn1,
      },
    }
  );
  t.like(pgRule, {
    name: rule.name,
    enabled: true,
    type: 'kinesis',
    arn: fakeKinesisSources1.arn,
    value: kinesisArn1,
    log_event_arn: fakeKinesisSources1.logEventArn,
  });
});

test.serial('post() creates the SQS rule with trigger information in Dynamo/PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const queue1 = randomId('queue');

  const stubbedRulesModel = new Rule({
    SqsUtils: {
      sqsQueueExists: () => Promise.resolve(true),
    },
    SqsClient: {
      getQueueAttributes: () => ({
        promise: () => Promise.resolve({
          Attributes: {
            RedrivePolicy: 'policy',
            VisibilityTimeout: 10,
          },
        }),
      }),
    },
  });

  const rule = fakeRuleFactoryV2({
    state: 'ENABLED',
    rule: {
      type: 'sqs',
      value: queue1,
    },
    collection: {
      name: pgCollection.name,
      version: pgCollection.version,
    },
    provider: pgProvider.name,
  });

  const expectedMeta = {
    visibilityTimeout: 10,
    retries: 3,
  };

  const expressRequest = {
    body: rule,
    testContext: {
      ruleModel: stubbedRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  const dynamoRule = await ruleModel.get({ name: rule.name });
  const pgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: rule.name });
  const esRule = await t.context.esRulesClient.get(
    rule.name
  );

  t.like(dynamoRule, {
    rule: {
      type: 'sqs',
      value: queue1,
    },
    meta: expectedMeta,
  });
  t.like(
    esRule,
    {
      rule: {
        type: 'sqs',
        value: queue1,
      },
      meta: expectedMeta,
    }
  );
  t.like(pgRule, {
    name: rule.name,
    enabled: true,
    type: 'sqs',
    value: queue1,
    meta: expectedMeta,
  });
});

test.serial('post() creates the SQS rule with the meta provided in Dynamo/PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const queue1 = randomId('queue');

  const stubbedRulesModel = new Rule({
    SqsUtils: {
      sqsQueueExists: () => Promise.resolve(true),
    },
    SqsClient: {
      getQueueAttributes: () => ({
        promise: () => Promise.resolve({
          Attributes: {
            RedrivePolicy: 'policy',
            VisibilityTimeout: 10,
          },
        }),
      }),
    },
  });

  const rule = fakeRuleFactoryV2({
    state: 'ENABLED',
    rule: {
      type: 'sqs',
      value: queue1,
    },
    collection: {
      name: pgCollection.name,
      version: pgCollection.version,
    },
    meta: {
      retries: 0,
      visibilityTimeout: 0,
    },
    provider: pgProvider.name,
  });

  const expectedMeta = {
    visibilityTimeout: 0,
    retries: 0,
  };

  const expressRequest = {
    body: rule,
    testContext: {
      ruleModel: stubbedRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  const dynamoRule = await ruleModel.get({ name: rule.name });
  const pgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: rule.name });
  const esRule = await t.context.esRulesClient.get(
    rule.name
  );

  t.like(dynamoRule, {
    rule: {
      type: 'sqs',
      value: queue1,
    },
    meta: expectedMeta,
  });
  t.like(
    esRule,
    {
      rule: {
        type: 'sqs',
        value: queue1,
      },
      meta: expectedMeta,
    }
  );
  t.like(pgRule, {
    name: rule.name,
    enabled: true,
    type: 'sqs',
    value: queue1,
    meta: expectedMeta,
  });
});

test('POST creates a rule in Dynamo and PG with correct timestamps', async (t) => {
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

  const fetchedDynamoRecord = await ruleModel.get({
    name: newRule.name,
  });
  const fetchedPostgresRecord = await t.context.rulePgModel
    .get(t.context.testKnex, { name: newRule.name });

  t.true(fetchedDynamoRecord.createdAt > newRule.createdAt);
  t.true(fetchedDynamoRecord.updatedAt > newRule.updatedAt);

  t.is(fetchedPostgresRecord.created_at.getTime(), fetchedDynamoRecord.createdAt);
  t.is(fetchedPostgresRecord.updated_at.getTime(), fetchedDynamoRecord.updatedAt);
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
  const { newRule, rulePgModel, testKnex } = t.context;
  const ruleWithTrigger = await ruleModel.createRuleTrigger(newRule);
  const dynamoRule = await ruleModel.create(ruleWithTrigger);

  const newPgRule = await translateApiRuleToPostgresRule(dynamoRule);
  await rulePgModel.create(testKnex, newPgRule);

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

test('POST returns a 400 response if rule name does not exist', async (t) => {
  const { newRule } = t.context;
  delete newRule.name;

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

test.serial('post() does not write to Elasticsearch/DynamoDB if writing to PostgreSQL fails', async (t) => {
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

  t.true(response.boom.badImplementation.calledWithMatch('something bad'));
  t.false(await ruleModel.exists(newRule.name));
  t.is(dbRecords.length, 0);
  t.false(await t.context.esRulesClient.exists(
    newRule.name
  ));
});

test.serial('post() does not write to Elasticsearch/PostgreSQL if writing to DynamoDB fails', async (t) => {
  const { newRule, testKnex } = t.context;

  const failingRulesModel = {
    exists: () => false,
    createRuleTrigger: () => Promise.resolve(newRule),
    create: () => {
      throw new Error('Rule error');
    },
    delete: () => Promise.resolve(true),
  };

  const expressRequest = {
    body: newRule,
    testContext: {
      knex: testKnex,
      ruleModel: failingRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  t.true(response.boom.badImplementation.calledWithMatch('Rule error'));

  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.false(await ruleModel.exists(newRule.name));
  t.false(await t.context.esRulesClient.exists(
    newRule.name
  ));
});

test.serial('post() does not write to DynamoDB/PostgreSQL if writing to Elasticsearch fails', async (t) => {
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

  t.true(response.boom.badImplementation.calledWithMatch('something bad'));

  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.false(await ruleModel.exists(newRule.name));
  t.false(await t.context.esRulesClient.exists(
    newRule.name
  ));
});

test('PUT replaces a rule', async (t) => {
  const {
    originalDynamoRule,
    originalEsRecord,
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queueUrl: 'fake-queue-url',
      collection: undefined,
      provider: undefined,
    }
  );

  const updateRule = {
    ...omit(originalDynamoRule, ['queueUrl', 'provider', 'collection']),
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

  const actualRule = await ruleModel.get({ name: updateRule.name });
  const actualPostgresRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRecord = await t.context.esRulesClient.get(
    originalDynamoRule.name
  );

  t.true(actualRule.updatedAt > updateRule.updatedAt);
  // PG and Dynamo records have the same timestamps
  t.is(actualPostgresRule.created_at.getTime(), actualRule.createdAt);
  t.is(actualPostgresRule.updated_at.getTime(), actualRule.updatedAt);
  t.is(actualPostgresRule.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPostgresRule.updated_at.getTime(), updatedEsRecord.updatedAt);

  t.deepEqual(actualPostgresRule, {
    ...originalPgRecord,
    queue_url: null,
    enabled: true,
    created_at: new Date(originalDynamoRule.createdAt),
    updated_at: new Date(actualRule.updatedAt),
  });
  t.deepEqual(actualRule, {
    // should not contain a queueUrl property
    ...updateRule,
    createdAt: originalDynamoRule.createdAt,
    updatedAt: actualRule.updatedAt,
  });
  t.deepEqual(
    updatedEsRecord,
    {
      ...omit(originalEsRecord, ['queueUrl']),
      state: 'ENABLED',
      createdAt: originalDynamoRule.createdAt,
      updatedAt: actualRule.updatedAt,
      timestamp: updatedEsRecord.timestamp,
    }
  );
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

test('put() does not write to PostgreSQL/Elasticsearch if writing to Dynamo fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
      queueUrl: 'queue-1',
    }
  );

  const fakeRulesModel = {
    get: () => Promise.resolve(originalDynamoRule),
    update: () => {
      throw new Error('something bad');
    },
    create: () => Promise.resolve(originalDynamoRule),
    createRuleTrigger: () => Promise.resolve(originalDynamoRule),
    updateRuleTrigger: () => Promise.resolve(originalDynamoRule),
  };

  const updatedRule = {
    ...omit(originalDynamoRule, ['collection', 'provider']),
    queueUrl: 'queue-2',
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updatedRule,
    testContext: {
      knex: testKnex,
      ruleModel: fakeRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['provider', 'collection'])
  );
  t.deepEqual(
    await t.context.rulePgModel.get(t.context.testKnex, {
      name: originalDynamoRule.name,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esRulesClient.get(
      originalDynamoRule.name
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
      queueUrl: 'queue-1',
    }
  );

  const fakerulePgModel = {
    get: () => Promise.resolve(originalPgRecord),
    upsert: () => {
      throw new Error('something bad');
    },
  };

  const updatedRule = {
    ...omit(originalDynamoRule, ['collection', 'provider']),
    queueUrl: 'queue-2',
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
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
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['provider', 'collection'])
  );
  t.deepEqual(
    await t.context.rulePgModel.get(t.context.testKnex, {
      name: originalDynamoRule.name,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esRulesClient.get(
      originalDynamoRule.name
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
      queueUrl: 'queue-1',
    }
  );

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const updatedRule = {
    ...omit(originalDynamoRule, ['collection', 'provider']),
    queueUrl: 'queue-2',
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
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
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['provider', 'collection'])
  );
  t.deepEqual(
    await t.context.rulePgModel.get(t.context.testKnex, {
      name: originalDynamoRule.name,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esRulesClient.get(
      originalDynamoRule.name
    ),
    originalEsRecord
  );
});

test.serial('put() creates the same updated SNS rule in Dynamo/PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();
  const topic2 = await awsServices.sns().createTopic({ Name: randomId('topic2_') }).promise();

  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queueUrl: 'fake-queue-url',
      state: 'ENABLED',
      rule: {
        type: 'sns',
        value: topic1.TopicArn,
      },
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalDynamoRule.rule.arn);
  t.truthy(originalEsRecord.rule.arn);
  t.truthy(originalPgRecord.arn);

  const updateRule = {
    ...originalDynamoRule,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updateRule,
  };

  const response = buildFakeExpressResponse();

  await put(expressRequest, response);

  const updatedRule = await ruleModel.get({ name: updateRule.name });
  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalDynamoRule.name
  );

  t.truthy(updatedRule.rule.arn);
  t.truthy(updatedEsRule.rule.arn);
  t.truthy(updatedPgRule.arn);

  t.not(updatedRule.rule.arn, originalDynamoRule.rule.arn);
  t.not(updatedEsRule.rule.arn, originalEsRecord.rule.arn);
  t.not(updatedPgRule.arn, originalPgRecord.arn);

  t.deepEqual(updatedRule, {
    ...originalDynamoRule,
    updatedAt: updatedRule.updatedAt,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
      arn: updatedRule.rule.arn,
    },
  });
  t.deepEqual(
    updatedEsRule,
    {
      ...originalEsRecord,
      updatedAt: updatedEsRule.updatedAt,
      timestamp: updatedEsRule.timestamp,
      rule: {
        type: 'sns',
        value: topic2.TopicArn,
        arn: updatedEsRule.rule.arn,
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

test.serial('put() creates the same updated Kinesis rule in Dynamo/PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const kinesisArn1 = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis1_')}`;
  const kinesisArn2 = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis2_')}`;

  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      state: 'ENABLED',
      rule: {
        type: 'kinesis',
        value: kinesisArn1,
      },
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalDynamoRule.rule.arn);
  t.truthy(originalDynamoRule.rule.logEventArn);
  t.truthy(originalEsRecord.rule.arn);
  t.truthy(originalEsRecord.rule.logEventArn);
  t.truthy(originalPgRecord.arn);
  t.truthy(originalPgRecord.log_event_arn);

  const updateRule = {
    ...originalDynamoRule,
    rule: {
      type: 'kinesis',
      value: kinesisArn2,
    },
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updateRule,
  };

  const response = buildFakeExpressResponse();

  await put(expressRequest, response);

  const updatedRule = await ruleModel.get({ name: updateRule.name });
  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalDynamoRule.name
  );

  t.truthy(updatedRule.rule.arn);
  t.truthy(updatedRule.rule.logEventArn);
  t.truthy(updatedEsRule.rule.arn);
  t.truthy(updatedEsRule.rule.logEventArn);
  t.truthy(updatedPgRule.arn);
  t.truthy(updatedPgRule.log_event_arn);

  t.not(originalDynamoRule.rule.arn, updatedRule.rule.arn);
  t.not(originalDynamoRule.rule.logEventArn, updatedRule.rule.logEventArn);
  t.not(originalEsRecord.rule.arn, updatedEsRule.rule.arn);
  t.not(originalEsRecord.rule.logEventArn, updatedEsRule.rule.logEventArn);
  t.not(originalPgRecord.arn, updatedPgRule.arn);
  t.not(originalPgRecord.log_event_arn, updatedPgRule.log_event_arn);

  t.deepEqual(updatedRule, {
    ...originalDynamoRule,
    updatedAt: updatedRule.updatedAt,
    rule: {
      arn: updatedRule.rule.arn,
      logEventArn: updatedRule.rule.logEventArn,
      type: 'kinesis',
      value: kinesisArn2,
    },
  });
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

test.serial('put() creates the same SQS rule in Dynamo/PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const queue1 = randomId('queue');
  const queue2 = randomId('queue');

  const stubbedRulesModel = new Rule({
    SqsUtils: {
      sqsQueueExists: () => Promise.resolve(true),
    },
    SqsClient: {
      getQueueAttributes: () => ({
        promise: () => Promise.resolve({
          Attributes: {
            RedrivePolicy: 'policy',
            VisibilityTimeout: 10,
          },
        }),
      }),
    },
  });

  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    {
      ...t.context,
      ruleModel: stubbedRulesModel,
    },
    {
      name: randomId('rule'),
      state: 'ENABLED',
      rule: {
        type: 'sqs',
        value: queue1,
      },
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  const expectedMeta = {
    visibilityTimeout: 10,
    retries: 3,
  };
  t.deepEqual(originalDynamoRule.meta, expectedMeta);
  t.deepEqual(originalPgRecord.meta, expectedMeta);
  t.deepEqual(originalEsRecord.meta, expectedMeta);

  const updateRule = {
    ...originalDynamoRule,
    rule: {
      type: 'sqs',
      value: queue2,
    },
  };
  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updateRule,
    testContext: {
      ruleModel: stubbedRulesModel,
    },
  };
  const response = buildFakeExpressResponse();
  await put(expressRequest, response);

  const updatedRule = await ruleModel.get({ name: updateRule.name });
  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    updateRule.name
  );

  t.deepEqual(updatedRule, {
    ...originalDynamoRule,
    updatedAt: updatedRule.updatedAt,
    rule: {
      type: 'sqs',
      value: queue2,
    },
  });
  t.deepEqual(
    updatedEsRule,
    {
      ...originalEsRecord,
      updatedAt: updatedEsRule.updatedAt,
      timestamp: updatedEsRule.timestamp,
      rule: {
        type: 'sqs',
        value: queue2,
      },
    }
  );
  t.deepEqual(updatedPgRule, {
    ...originalPgRecord,
    updated_at: updatedPgRule.updated_at,
    type: 'sqs',
    value: queue2,
  });
});

test.serial('put() keeps initial trigger information if writing to Dynamo fails', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();
  const topic2 = await awsServices.sns().createTopic({ Name: randomId('topic2_') }).promise();

  const deleteOldEventSourceMappingsSpy = sinon.spy(Rule.prototype, 'deleteOldEventSourceMappings');
  const updateStub = sinon.stub(Rule.prototype, 'update').throws(new Error('Dynamo fail'));
  t.teardown(() => {
    updateStub.restore();
    deleteOldEventSourceMappingsSpy.restore();
  });

  const stubbedRulesModel = new Rule();

  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    {
      ...t.context,
      ruleModel: stubbedRulesModel,
    },
    {
      state: 'ENABLED',
      rule: {
        type: 'sns',
        value: topic1.TopicArn,
      },
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalDynamoRule.rule.arn);
  t.truthy(originalEsRecord.rule.arn);
  t.truthy(originalPgRecord.arn);

  const updateRule = {
    ...originalDynamoRule,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updateRule,
    testContext: {
      ruleModel: stubbedRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'Dynamo fail' }
  );

  t.false(deleteOldEventSourceMappingsSpy.called);

  const updatedRule = await ruleModel.get({ name: updateRule.name });
  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalDynamoRule.name
  );

  t.is(updatedRule.rule.arn, originalDynamoRule.rule.arn);
  t.is(updatedEsRule.rule.arn, originalEsRecord.rule.arn);
  t.is(updatedPgRule.arn, originalPgRecord.arn);

  t.like(updatedRule, {
    ...originalDynamoRule,
    updatedAt: updatedRule.updatedAt,
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
    },
  });
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

test.serial('put() keeps initial trigger information if writing to PostgreSQL fails', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().createTopic({ Name: randomId('topic1_') }).promise();
  const topic2 = await awsServices.sns().createTopic({ Name: randomId('topic2_') }).promise();

  const deleteOldEventSourceMappingsSpy = sinon.spy(Rule.prototype, 'deleteOldEventSourceMappings');
  t.teardown(() => {
    deleteOldEventSourceMappingsSpy.restore();
  });

  const stubbedRulesModel = new Rule();

  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    {
      ...t.context,
      ruleModel: stubbedRulesModel,
    },
    {
      state: 'ENABLED',
      rule: {
        type: 'sns',
        value: topic1.TopicArn,
      },
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalDynamoRule.rule.arn);
  t.truthy(originalEsRecord.rule.arn);
  t.truthy(originalPgRecord.arn);

  const updateRule = {
    ...originalDynamoRule,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updateRule,
    testContext: {
      ruleModel: stubbedRulesModel,
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

  const updatedRule = await ruleModel.get({ name: updateRule.name });
  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalDynamoRule.name
  );

  t.is(updatedRule.rule.arn, originalDynamoRule.rule.arn);
  t.is(updatedEsRule.rule.arn, originalEsRecord.rule.arn);
  t.is(updatedPgRule.arn, originalPgRecord.arn);

  t.like(updatedRule, {
    ...originalDynamoRule,
    updatedAt: updatedRule.updatedAt,
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
    },
  });
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

  const deleteOldEventSourceMappingsSpy = sinon.spy(Rule.prototype, 'deleteOldEventSourceMappings');
  t.teardown(() => {
    deleteOldEventSourceMappingsSpy.restore();
  });

  const stubbedRulesModel = new Rule();

  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    {
      ...t.context,
      ruleModel: stubbedRulesModel,
    },
    {
      state: 'ENABLED',
      rule: {
        type: 'sns',
        value: topic1.TopicArn,
      },
      collection: {
        name: pgCollection.name,
        version: pgCollection.version,
      },
      provider: pgProvider.name,
    }
  );

  t.truthy(originalDynamoRule.rule.arn);
  t.truthy(originalEsRecord.rule.arn);
  t.truthy(originalPgRecord.arn);

  const updateRule = {
    ...originalDynamoRule,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updateRule,
    testContext: {
      ruleModel: stubbedRulesModel,
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

  const updatedRule = await ruleModel.get({ name: updateRule.name });
  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    originalDynamoRule.name
  );

  t.is(updatedRule.rule.arn, originalDynamoRule.rule.arn);
  t.is(updatedEsRule.rule.arn, originalEsRecord.rule.arn);
  t.is(updatedPgRule.arn, originalPgRecord.arn);

  t.like(updatedRule, {
    ...originalDynamoRule,
    updatedAt: updatedRule.updatedAt,
    rule: {
      type: 'sns',
      value: topic1.TopicArn,
    },
  });
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
  const nonExistentRule = fakeRuleFactoryV2();
  const response = await request(app)
    .delete(`/rules/${nonExistentRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, 'No record found');
});

test('DELETE deletes rule that exists in PostgreSQL and DynamoDB but not Elasticsearch', async (t) => {
  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const newRule = fakeRuleFactoryV2();
  delete newRule.collection;
  delete newRule.provider;
  const ruleWithTrigger = await ruleModel.createRuleTrigger(newRule);
  const apiRule = await ruleModel.create(ruleWithTrigger);
  const translatedRule = await translateApiRuleToPostgresRule(apiRule, testKnex);
  await rulePgModel.create(testKnex, translatedRule);

  t.false(
    await esRulesClient.exists(
      translatedRule.name
    )
  );
  t.true(
    await rulePgModel.exists(testKnex, {
      name: translatedRule.name,
    })
  );
  const response = await request(app)
    .delete(`/rules/${translatedRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { message } = response.body;
  const dbRecords = await rulePgModel
    .search(testKnex, { name: translatedRule.name });

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
  const newRule = fakeRuleFactoryV2();
  const ruleWithTrigger = await ruleModel.createRuleTrigger(newRule);
  await ruleModel.create(ruleWithTrigger);
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
  const { newRule } = t.context;

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
  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.is(message, 'Record deleted');
  t.false(
    await t.context.esRulesClient.exists(
      newRule.name
    )
  );
});

test('del() does not remove from PostgreSQL/Elasticsearch if removing from Dynamo fails', async (t) => {
  const {
    originalDynamoRule,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
    }
  );

  const fakeRulesModel = {
    get: () => Promise.resolve(originalDynamoRule),
    delete: () => {
      throw new Error('something bad');
    },
    create: () => Promise.resolve(true),
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    testContext: {
      knex: t.context.testKnex,
      ruleModel: fakeRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['collection', 'provider'])
  );
  t.true(
    await t.context.rulePgModel.exists(t.context.testKnex, {
      name: originalDynamoRule.name,
    })
  );
  t.true(
    await t.context.esRulesClient.exists(
      originalDynamoRule.name
    )
  );
});

test('del() does not remove from Dynamo/Elasticsearch if removing from PostgreSQL fails', async (t) => {
  const {
    originalDynamoRule,
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
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
      name: originalDynamoRule.name,
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

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['collection', 'provider'])
  );
  t.true(
    await t.context.rulePgModel.exists(t.context.testKnex, {
      name: originalDynamoRule.name,
    })
  );
  t.true(
    await t.context.esRulesClient.exists(
      originalDynamoRule.name
    )
  );
});

test('del() does not remove from Dynamo/PostgreSQL if removing from Elasticsearch fails', async (t) => {
  const {
    originalDynamoRule,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
    }
  );

  const fakeEsClient = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
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

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['collection', 'provider'])
  );
  t.true(
    await t.context.rulePgModel.exists(t.context.testKnex, {
      name: originalDynamoRule.name,
    })
  );
  t.true(
    await t.context.esRulesClient.exists(
      originalDynamoRule.name
    )
  );
});
