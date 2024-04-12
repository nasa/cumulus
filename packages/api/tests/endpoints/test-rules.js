'use strict';

const fs = require('fs-extra');
const cloneDeep = require('lodash/cloneDeep');
const merge = require('lodash/merge');
const omit = require('lodash/omit');
const pick = require('lodash/pick');
const test = require('ava');
const sinon = require('sinon');
const {
  CreateFunctionCommand,
  AddPermissionCommand,
  RemovePermissionCommand,
} = require('@aws-sdk/client-lambda');
const { mockClient } = require('aws-sdk-client-mock');

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

const {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  UnsubscribeCommand,
} = require('@aws-sdk/client-sns');

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
const { patch, post, put, del } = require('../../endpoints/rules');

const rulesHelpers = require('../../lib/rulesHelpers');
const AccessToken = require('../../models/access-tokens');
const assertions = require('../../lib/assertions');
const { request } = require('../helpers/request');

const { version } = require('../../lib/version');

[
  'AccessTokensTable',
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

  await Promise.all(
    ['messageConsumer', 'KinesisInboundEventLogger'].map(async (name) => {
      const lambdaCreated = await awsServices.lambda().send(new CreateFunctionCommand({
        Code: {
          ZipFile: fs.readFileSync(require.resolve('@cumulus/test-data/fake-lambdas/hello.zip')),
        },
        FunctionName: randomId(name),
        Role: `arn:aws:iam::123456789012:role/${randomId('role')}`,
        Handler: 'index.handler',
        Runtime: 'nodejs16.x',
      }));
      process.env[name] = lambdaCreated.FunctionName;
    })
  );

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

test('CUMULUS-911 PATCH with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .patch('/rules/asdf')
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

test('POST with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .post('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 PATCH with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .patch('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('PATCH with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .patch('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('PUT with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 DELETE with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('DELETE with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

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

test.serial('post() creates SNS rule with same trigger information in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic1_') }));

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
    workflow,
  });

  const expressRequest = {
    body: rule,
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  const pgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: rule.name });
  const esRule = await t.context.esRulesClient.get(
    rule.name
  );

  t.truthy(pgRule.arn);
  t.truthy(esRule.rule.arn);

  t.like(
    esRule,
    {
      rule: {
        type: 'sns',
        value: topic1.TopicArn,
        arn: pgRule.arn,
      },
    }
  );
  t.like(pgRule, {
    name: rule.name,
    enabled: true,
    type: 'sns',
    arn: esRule.rule.arn,
    value: topic1.TopicArn,
  });
});

test.serial('post() creates the same Kinesis rule with trigger information in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const kinesisArn1 = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis1_')}`;

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
    workflow,
  });

  const expressRequest = {
    body: rule,
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  const pgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: rule.name });
  const esRule = await t.context.esRulesClient.get(
    rule.name
  );

  t.truthy(esRule.rule.arn);
  t.truthy(esRule.rule.logEventArn);
  t.truthy(pgRule.arn);
  t.truthy(pgRule.log_event_arn);
  t.like(
    esRule,
    {
      ...rule,
      rule: {
        type: 'kinesis',
        value: kinesisArn1,
      },
    }
  );
  t.like(pgRule, {
    name: rule.name,
    enabled: true,
    type: 'kinesis',
    value: kinesisArn1,
  });
});

test.serial('post() creates the SQS rule with trigger information in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const queue1 = randomId('queue');
  const { queueUrl: queueUrl1 } = await createSqsQueues(queue1);

  const rule = fakeRuleFactoryV2({
    state: 'ENABLED',
    rule: {
      type: 'sqs',
      value: queueUrl1,
    },
    workflow,
    collection: {
      name: pgCollection.name,
      version: pgCollection.version,
    },
    provider: pgProvider.name,
  });

  const expectedMeta = {
    visibilityTimeout: 300,
    retries: 3,
  };

  const expressRequest = {
    body: rule,
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  const pgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: rule.name });
  const esRule = await t.context.esRulesClient.get(
    rule.name
  );

  t.like(
    esRule,
    {
      rule: {
        type: 'sqs',
        value: queueUrl1,
      },
      meta: expectedMeta,
    }
  );
  t.like(pgRule, {
    name: rule.name,
    enabled: true,
    type: 'sqs',
    value: queueUrl1,
    meta: expectedMeta,
  });
});

test.serial('post() creates the SQS rule with the meta provided in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const queue1 = randomId('queue');
  const { queueUrl: queueUrl1 } = await createSqsQueues(queue1);

  const rule = fakeRuleFactoryV2({
    state: 'ENABLED',
    rule: {
      type: 'sqs',
      value: queueUrl1,
    },
    workflow,
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
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  const pgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: rule.name });
  const esRule = await t.context.esRulesClient.get(
    rule.name
  );

  t.like(
    esRule,
    {
      rule: {
        type: 'sqs',
        value: queueUrl1,
      },
      meta: expectedMeta,
    }
  );
  t.like(pgRule, {
    name: rule.name,
    enabled: true,
    type: 'sqs',
    value: queueUrl1,
    meta: expectedMeta,
  });
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
  const regexp = new RegExp('The record has validation errors:.*rule.type.*should be equal to one of the allowed values');
  t.truthy(message.match(regexp));
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
    client: {
      index: () => Promise.reject(new Error('something bad')),
    },
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

test.serial('PATCH updates an existing rule in all data stores', async (t) => {
  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const oldMetaFields = {
    nestedFieldOne: {
      fieldOne: 'fieldone-data',
      'key.with.period': randomId('key.with.period'),
    },
  };

  const {
    originalApiRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
      meta: oldMetaFields,
      tags: ['tag1', 'tag2'],
    }
  );

  t.deepEqual(originalPgRecord.meta, oldMetaFields);
  t.is(originalPgRecord.payload, null);
  t.deepEqual(originalEsRecord.meta, oldMetaFields);
  t.is(originalEsRecord.payload, undefined);

  const updateMetaFields = {
    nestedFieldOne: {
      nestedFieldOneKey2: randomId('nestedFieldOneKey2'),
      'key.with.period.2': randomId('key.with.period.2'),
    },
    nestedFieldTwo: {
      nestedFieldTwoKey1: randomId('nestedFieldTwoKey1'),
    },
  };
  const updatePayload = {
    foo: 'bar',
  };
  const updateRule = {
    ...omit(originalApiRule, ['queueUrl', 'provider', 'collection', 'payload']),
    state: 'ENABLED',
    meta: updateMetaFields,
    payload: updatePayload,
    // these timestamps should not get used
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await request(app)
    .patch(`/rules/${updateRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(200);

  const actualPostgresRule = await rulePgModel.get(testKnex, { name: updateRule.name });
  const updatedEsRecord = await esRulesClient.get(originalApiRule.name);
  const expectedMeta = merge(cloneDeep(oldMetaFields), updateMetaFields);

  // PG and ES records have the same timestamps
  t.true(actualPostgresRule.updated_at > originalPgRecord.updated_at);
  t.is(actualPostgresRule.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPostgresRule.updated_at.getTime(), updatedEsRecord.updatedAt);
  t.deepEqual(
    updatedEsRecord,
    {
      ...originalEsRecord,
      state: 'ENABLED',
      meta: expectedMeta,
      payload: updatePayload,
      createdAt: originalPgRecord.created_at.getTime(),
      updatedAt: actualPostgresRule.updated_at.getTime(),
      timestamp: updatedEsRecord.timestamp,
    }
  );
  t.deepEqual(
    actualPostgresRule,
    {
      ...originalPgRecord,
      enabled: true,
      meta: expectedMeta,
      payload: updatePayload,
      created_at: originalPgRecord.created_at,
      updated_at: actualPostgresRule.updated_at,
    }
  );
});

test.serial('PATCH nullifies expected fields for existing rule in all datastores', async (t) => {
  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const oldMetaFields = {
    nestedFieldOne: {
      fieldOne: 'fieldone-data',
    },
  };

  const {
    originalApiRule,
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
      meta: oldMetaFields,
      execution_name_prefix: 'testRule',
      payload: { foo: 'bar' },
      value: randomId('value'),
      tags: ['tag1', 'tag2'],
    }
  );

  const updateRule = {
    name: originalApiRule.name,
    workflow: originalApiRule.workflow,
    executionNamePrefix: null,
    meta: null,
    payload: null,
    queueUrl: null,
    rule: {
      value: null,
    },
    createdAt: null,
    updatedAt: null,
    tags: null,
  };

  await request(app)
    .patch(`/rules/${updateRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(200);

  const actualPostgresRule = await rulePgModel.get(testKnex, { name: updateRule.name });
  const updatedEsRecord = await esRulesClient.get(originalApiRule.name);
  const apiRule = await translatePostgresRuleToApiRule(actualPostgresRule, testKnex);

  const expectedApiRule = {
    ...pick(originalApiRule, ['name', 'workflow', 'createdAt', 'state']),
    rule: {
      type: originalApiRule.rule.type,
    },
    updatedAt: apiRule.updatedAt,
  };
  t.deepEqual(apiRule, expectedApiRule);

  const expectedEsRecord = {
    ...expectedApiRule,
    _id: updatedEsRecord._id,
    timestamp: updatedEsRecord.timestamp,
  };
  t.deepEqual(updatedEsRecord, expectedEsRecord);

  t.deepEqual(
    actualPostgresRule,
    {
      ...originalPgRecord,
      enabled: false,
      execution_name_prefix: null,
      meta: null,
      payload: null,
      queue_url: null,
      type: originalApiRule.rule.type,
      value: null,
      tags: null,
      created_at: originalPgRecord.created_at,
      updated_at: actualPostgresRule.updated_at,
    }
  );
});

test.serial('PATCH sets SNS rule to "disabled" and removes source mapping ARN', async (t) => {
  const snsMock = mockClient(awsServices.sns());

  snsMock
    .onAnyCommand()
    .rejects()
    .on(ListSubscriptionsByTopicCommand)
    .resolves({
      Subscriptions: [{
        Endpoint: process.env.messageConsumer,
        SubscriptionArn: randomString(),
      }],
    })
    .on(UnsubscribeCommand)
    .resolves({});

  const mockLambdaClient = mockClient(awsServices.lambda()).onAnyCommand().rejects();
  mockLambdaClient.on(AddPermissionCommand).resolves();
  mockLambdaClient.on(RemovePermissionCommand).resolves();

  t.teardown(() => {
    snsMock.restore();
    mockLambdaClient.restore();
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

  const updateRule = {
    name: originalPgRecord.name,
    state: 'DISABLED',
  };

  await request(app)
    .patch(`/rules/${updateRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(200);

  const updatedPostgresRule = await rulePgModel.get(testKnex, { name: originalPgRecord.name });
  const updatedEsRecord = await esRulesClient.get(originalPgRecord.name);

  t.is(updatedPostgresRule.arn, null);
  t.is(updatedEsRecord.rule.arn, undefined);
});

test('PATCH returns 404 for non-existent rule', async (t) => {
  const name = 'new_make_coffee';
  const response = await request(app)
    .patch(`/rules/${name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ name })
    .expect(404);

  const { message, record } = response.body;
  t.true(message.includes(name));
  t.falsy(record);
});

test('PATCH returns 400 for name mismatch between params and payload',
  async (t) => {
    const response = await request(app)
      .patch(`/rules/${randomString()}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ name: randomString() })
      .expect(400);
    const { message, record } = response.body;

    t.true(message.includes('Expected rule name to be'));
    t.falsy(record);
  });

test('PATCH returns a 400 response if record is missing workflow property', async (t) => {
  const {
    originalApiRule,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
    }
  );

  const updateRule = {
    name: originalApiRule.name,
    workflow: null,
  };

  const response = await request(app)
    .patch(`/rules/${originalApiRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(400);
  const { message } = response.body;
  t.true(message.includes('The record has validation errors. Rule workflow is undefined'));
});

test('PATCH returns a 400 response if record is missing type property', async (t) => {
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

  const updateRule = {
    name: originalApiRule.name,
    rule: {
      type: null,
    },
  };

  originalApiRule.rule.type = null;
  const response = await request(app)
    .patch(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(400);
  const { message } = response.body;
  t.true(message.includes('The record has validation errors. Rule type is undefined.'));
});

test('PATCH returns a 400 response if rule name is invalid', async (t) => {
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
  const updateRule = {
    name: 'bad rule name',
  };
  const response = await request(app)
    .patch(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(400);
  const { message } = response.body;
  t.true(message.includes(originalApiRule.name));
  t.true(message.includes(updateRule.name));
});

test('PATCH returns a 400 response if rule type is invalid', async (t) => {
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

  const updateRule = {
    name: originalApiRule.name,
    rule: {
      type: 'invalid',
    },
  };

  const response = await request(app)
    .patch(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(400);

  const { message } = response.body;
  const regexp = new RegExp('The record has validation errors:.*rule.type.*should be equal to one of the allowed values');
  t.truthy(message.match(regexp));
});

test('PATCH returns a 400 response if rule value is not specified for non-onetime rule', async (t) => {
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

  const updateRule = {
    name: originalApiRule.name,
    rule: {
      type: 'sns',
    },
  };

  const response = await request(app)
    .patch(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(400);

  const { message } = response.body;
  const regexp = new RegExp('Rule value is undefined for sns rule');
  t.truthy(message.match(regexp));
});

test('PATCH does not write to Elasticsearch if writing to PostgreSQL fails', async (t) => {
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
    name: originalApiRule.name,
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
    patch(expressRequest, response),
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

test('PATCH does not write to PostgreSQL if writing to Elasticsearch fails', async (t) => {
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
    client: {
      index: () => Promise.reject(new Error('something bad')),
    },
  };

  const updatedRule = {
    name: originalApiRule.name,
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
    patch(expressRequest, response),
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

test.serial('PATCH creates the same updated SNS rule in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic1_') }));
  const topic2 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic2_') }));

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
    name: originalPgRecord.name,
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
  await patch(expressRequest, response);
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

test.serial('PATCH creates the same updated Kinesis rule in PostgreSQL/Elasticsearch', async (t) => {
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
    name: originalPgRecord.name,
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

  await patch(expressRequest, response);

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

test.serial('PATCH creates the same SQS rule in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const queue1 = randomId('queue');
  const queue2 = randomId('queue');

  const { queueUrl: queueUrl1 } = await createSqsQueues(queue1);
  const { queueUrl: queueUrl2 } = await createSqsQueues(queue2, 4, '100');

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

  t.deepEqual(originalPgRecord.meta, expectedMeta);
  t.deepEqual(originalEsRecord.meta, expectedMeta);

  const updateRule = {
    name: originalPgRecord.name,
    rule: {
      type: 'sqs',
      value: queueUrl2,
    },
    meta: {
      retries: 2,
      visibilityTimeout: null,
    },
  };
  const expressRequest = {
    params: {
      name: originalPgRecord.name,
    },
    body: updateRule,
  };
  const response = buildFakeExpressResponse();
  await patch(expressRequest, response);

  const updatedPgRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRule = await t.context.esRulesClient.get(
    updateRule.name
  );

  const expectedMetaUpdate = {
    visibilityTimeout: 100,
    retries: 2,
  };

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
      meta: expectedMetaUpdate,
    }
  );
  t.deepEqual(updatedPgRule, {
    ...originalPgRecord,
    updated_at: updatedPgRule.updated_at,
    type: 'sqs',
    value: queueUrl2,
    meta: expectedMetaUpdate,
  });
});

test.serial('PATCH keeps initial trigger information if writing to PostgreSQL fails', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic1_') }));
  const topic2 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic2_') }));

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
    name: originalPgRecord.name,
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
    patch(expressRequest, response),
    { message: 'PG fail' }
  );

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

test.serial('PATCH keeps initial trigger information if writing to Elasticsearch fails', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic1_') }));
  const topic2 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic2_') }));

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
    name: originalPgRecord.name,
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
        client: {
          index: () => {
            throw new Error('ES fail');
          },
        },
      },
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    patch(expressRequest, response),
    { message: 'ES fail' }
  );

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

test.serial('PUT replaces an existing rule in all data stores', async (t) => {
  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const oldMetaFields = {
    nestedFieldOne: {
      fieldOne: 'fieldone-data',
    },
  };

  const {
    originalApiRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
      meta: oldMetaFields,
      tags: ['tag1', 'tag2'],
    }
  );

  t.deepEqual(originalPgRecord.meta, oldMetaFields);
  t.is(originalPgRecord.payload, null);
  t.deepEqual(originalEsRecord.meta, oldMetaFields);
  t.is(originalEsRecord.payload, undefined);

  const updateMetaFields = {
    nestedFieldOne: {
      nestedFieldOneKey2: randomId('nestedFieldOneKey2'),
      'key.with.period': randomId('key.with.period'),
    },
    nestedFieldTwo: {
      nestedFieldTwoKey1: randomId('nestedFieldTwoKey1'),
    },
  };
  const updatePayload = {
    foo: 'bar',
  };
  const updateTags = ['tag2', 'tag3'];
  const removedFields = ['queueUrl', 'queue_url', 'provider', 'collection'];
  const updateRule = {
    ...omit(originalApiRule, removedFields),
    state: 'ENABLED',
    meta: updateMetaFields,
    payload: updatePayload,
    tags: updateTags,
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
  const updatedEsRecord = await esRulesClient.get(originalApiRule.name);

  // PG and ES records have the same timestamps
  t.true(actualPostgresRule.updated_at > originalPgRecord.updated_at);
  t.is(actualPostgresRule.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPostgresRule.updated_at.getTime(), updatedEsRecord.updatedAt);
  t.deepEqual(
    updatedEsRecord,
    {
      ...omit(originalEsRecord, removedFields),
      state: 'ENABLED',
      meta: updateMetaFields,
      payload: updatePayload,
      tags: updateTags,
      createdAt: originalApiRule.createdAt,
      updatedAt: updatedEsRecord.updatedAt,
      timestamp: updatedEsRecord.timestamp,
    }
  );
  t.deepEqual(
    actualPostgresRule,
    {
      ...omit(originalPgRecord, removedFields),
      enabled: true,
      meta: updateMetaFields,
      payload: updatePayload,
      tags: updateTags,
      queue_url: null,
      created_at: originalPgRecord.created_at,
      updated_at: actualPostgresRule.updated_at,
    }
  );
});

test.serial('PUT removes existing fields if not specified or set to null', async (t) => {
  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const oldMetaFields = {
    nestedFieldOne: {
      fieldOne: 'fieldone-data',
    },
  };

  const {
    originalApiRule,
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queue_url: 'fake-queue-url',
      workflow,
      meta: oldMetaFields,
      execution_name_prefix: 'testRule',
      payload: { foo: 'bar' },
      value: randomId('value'),
      tags: ['tag1', 'tag2'],
    }
  );

  const removedFields = ['provider', 'collection', 'payload', 'tags'];
  const updateRule = {
    ...omit(originalApiRule, removedFields),
    executionNamePrefix: null,
    meta: null,
    queueUrl: null,
    rule: {
      type: originalApiRule.rule.type,
    },
    createdAt: null,
    updatedAt: null,
  };

  await request(app)
    .put(`/rules/${updateRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(200);

  const actualPostgresRule = await rulePgModel.get(testKnex, { name: updateRule.name });
  const updatedEsRecord = await esRulesClient.get(originalApiRule.name);
  const apiRule = await translatePostgresRuleToApiRule(actualPostgresRule, testKnex);

  const expectedApiRule = {
    ...pick(originalApiRule, ['name', 'workflow', 'createdAt', 'state']),
    rule: {
      type: originalApiRule.rule.type,
    },
    updatedAt: apiRule.updatedAt,
  };
  t.deepEqual(apiRule, expectedApiRule);

  const expectedEsRecord = {
    ...expectedApiRule,
    _id: updatedEsRecord._id,
    timestamp: updatedEsRecord.timestamp,
  };
  t.deepEqual(updatedEsRecord, expectedEsRecord);

  t.deepEqual(
    actualPostgresRule,
    {
      ...originalPgRecord,
      enabled: false,
      execution_name_prefix: null,
      meta: null,
      payload: null,
      queue_url: null,
      type: originalApiRule.rule.type,
      value: null,
      tags: null,
      created_at: originalPgRecord.created_at,
      updated_at: actualPostgresRule.updated_at,
    }
  );
});

test.serial('PUT sets SNS rule to "disabled" and removes source mapping ARN', async (t) => {
  const snsMock = mockClient(awsServices.sns());

  snsMock
    .onAnyCommand()
    .rejects()
    .on(ListSubscriptionsByTopicCommand)
    .resolves({
      Subscriptions: [{
        Endpoint: process.env.messageConsumer,
        SubscriptionArn: randomString(),
      }],
    })
    .on(UnsubscribeCommand)
    .resolves({});
  const mockLambdaClient = mockClient(awsServices.lambda()).onAnyCommand().rejects();
  mockLambdaClient.on(AddPermissionCommand).resolves();
  mockLambdaClient.on(RemovePermissionCommand).resolves();

  t.teardown(() => {
    snsMock.restore();
    mockLambdaClient.restore();
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
  const regexp = new RegExp('The record has validation errors:.*rule.type.*should be equal to one of the allowed values');
  t.truthy(message.match(regexp));
});

test('PUT returns a 400 response if rule value is not specified for non-onetime rule', async (t) => {
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
  originalApiRule.rule.type = 'kinesis';

  const response = await request(app)
    .put(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(originalApiRule)
    .expect(400);

  const { message } = response.body;
  const regexp = new RegExp('Rule value is undefined for kinesis rule');
  t.truthy(message.match(regexp));
});

test('PUT does not write to Elasticsearch if writing to PostgreSQL fails', async (t) => {
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

test('PUT does not write to PostgreSQL if writing to Elasticsearch fails', async (t) => {
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
    client: {
      index: () => Promise.reject(new Error('something bad')),
    },
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

test.serial('PUT creates the same updated SNS rule in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic1_') }));
  const topic2 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic2_') }));

  const {
    originalApiRule,
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
    ...originalApiRule,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalApiRule.name,
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

test.serial('PUT creates the same updated Kinesis rule in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const kinesisArn1 = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis1_')}`;
  const kinesisArn2 = `arn:aws:kinesis:us-east-1:000000000000:${randomId('kinesis2_')}`;

  const {
    originalApiRule,
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
    ...originalApiRule,
    rule: {
      type: 'kinesis',
      value: kinesisArn2,
    },
  };

  const expressRequest = {
    params: {
      name: originalApiRule.name,
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

test.serial('PUT creates the same SQS rule in PostgreSQL/Elasticsearch', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const queue1 = randomId('queue');
  const queue2 = randomId('queue');

  const { queueUrl: queueUrl1 } = await createSqsQueues(queue1);
  const { queueUrl: queueUrl2 } = await createSqsQueues(queue2, 4, '100');

  const {
    originalApiRule,
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

  t.deepEqual(originalPgRecord.meta, expectedMeta);
  t.deepEqual(originalEsRecord.meta, expectedMeta);

  const updateRule = {
    ...originalApiRule,
    rule: {
      type: 'sqs',
      value: queueUrl2,
    },
    meta: {
      retries: 2,
    },
  };
  const expressRequest = {
    params: {
      name: originalApiRule.name,
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
  const expectedMetaUpdate = {
    visibilityTimeout: 100,
    retries: 2,
  };
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
      meta: expectedMetaUpdate,
    }
  );
  t.deepEqual(updatedPgRule, {
    ...originalPgRecord,
    updated_at: updatedPgRule.updated_at,
    type: 'sqs',
    value: queueUrl2,
    meta: expectedMetaUpdate,
  });
});

test.serial('PUT keeps initial trigger information if writing to PostgreSQL fails', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic1_') }));
  const topic2 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic2_') }));

  const {
    originalApiRule,
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
    ...originalApiRule,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalApiRule.name,
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

test.serial('PUT keeps initial trigger information if writing to Elasticsearch fails', async (t) => {
  const {
    pgProvider,
    pgCollection,
  } = t.context;

  const topic1 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic1_') }));
  const topic2 = await awsServices.sns().send(new CreateTopicCommand({ Name: randomId('topic2_') }));

  const {
    originalApiRule,
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
    ...originalApiRule,
    rule: {
      type: 'sns',
      value: topic2.TopicArn,
    },
  };

  const expressRequest = {
    params: {
      name: originalApiRule.name,
    },
    body: updateRule,
    testContext: {
      esClient: {
        client: {
          index: () => {
            throw new Error('ES fail');
          },
        },
      },
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'ES fail' }
  );

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

test.serial('PUT returns 400 for version value less than the configured value', async (t) => {
  const fakeRule = fakeRuleFactoryV2();
  const response = await request(app)
    .put(`/rules/${fakeRule.name}`)
    .set('Cumulus-API-Version', '0')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(fakeRule)
    .expect(400);
  t.is(response.status, 400);
  t.true(response.text.includes("This API endpoint requires 'Cumulus-API-Version' header"));
});

test.serial('PATCH returns 400 for version value less than the configured value', async (t) => {
  const fakeRule = fakeRuleFactoryV2();
  const response = await request(app)
    .patch(`/rules/${fakeRule.name}`)
    .set('Cumulus-API-Version', '0')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ state: 'ENABLED' })
    .expect(400);
  t.is(response.status, 400);
  t.true(response.text.includes("This API endpoint requires 'Cumulus-API-Version' header"));
});

test.serial('PUT returns 200 for version value greater than the configured value', async (t) => {
  const {
    originalApiRule,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
    }
  );
  const response = await request(app)
    .put(`/rules/${originalApiRule.name}`)
    .set('Cumulus-API-Version', `${version + 1}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ ...originalApiRule, state: 'ENABLED' })
    .expect(200);
  t.is(response.status, 200);
});

test.serial('PATCH returns 200 for version value greater than the configured value', async (t) => {
  const {
    originalApiRule,
  } = await createRuleTestRecords(
    t.context,
    {
      workflow,
    }
  );
  const response = await request(app)
    .patch(`/rules/${originalApiRule.name}`)
    .set('Cumulus-API-Version', `${version + 1}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ state: 'ENABLED' })
    .expect(200);
  t.is(response.status, 200);
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
    client: {
      delete: () => {
        throw new Error('something bad');
      },
    },
    initializeEsClient: () => Promise.resolve(),
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
