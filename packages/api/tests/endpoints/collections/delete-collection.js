'use strict';

const test = require('ava');
const request = require('supertest');
const {
  s3,
  sns,
  sqs,
} = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
} = require('@cumulus/db');
const {
  constructCollectionId,
} = require('@cumulus/message/Collections');
const EsCollection = require('@cumulus/es-client/collections');
const { indexCollection } = require('@cumulus/es-client/indexer');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const models = require('../../../models');
const {
  fakeCollectionFactory,
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  createCollectionTestRecords,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');
const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');
const { del } = require('../../../endpoints/collections');

process.env.AccessTokensTable = randomString();
process.env.CollectionsTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

const { buildFakeExpressResponse } = require('../utils');

let jwtAuthToken;
let accessTokenModel;
let ruleModel;

const testDbName = randomString(12);

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.collectionPgModel = new CollectionPgModel();

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esCollectionClient = new EsCollection(
    {},
    undefined,
    t.context.esIndex
  );

  await s3().createBucket({ Bucket: process.env.system_bucket });

  t.context.collectionModel = new models.Collection({ tableName: process.env.CollectionsTable });
  await t.context.collectionModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  process.env.RulesTable = randomString();
  ruleModel = new models.Rule();
  await ruleModel.createTable();

  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflow_template.json`,
    Body: JSON.stringify({}),
  });
});

test.beforeEach(async (t) => {
  t.context.testCollection = fakeCollectionFactory();
  await t.context.collectionModel.create(t.context.testCollection);

  const topicName = randomString();
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.collection_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  }).promise();
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }).promise();

  await sns().confirmSubscription({
    TopicArn,
    Token: SubscriptionArn,
  }).promise();
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn }).promise();
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await t.context.collectionModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await cleanupTestIndex(t.context);
  await ruleModel.deleteTable();
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('Attempting to delete a collection without an Authorization header returns an Authorization Missing response', async (t) => {
  const { testCollection } = t.context;
  const response = await request(app)
    .delete(`/collections/${testCollection.name}/${testCollection.version}`)
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
  t.true(
    await t.context.collectionModel.exists(
      testCollection.name,
      testCollection.version
    )
  );
});

test('Attempting to delete a collection with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('Attempting to delete a collection with an unauthorized user returns an unauthorized response');

test('DELETE returns a 404 if PostgreSQL collection cannot be found', async (t) => {
  const nonExistentCollection = fakeCollectionFactory();
  const response = await request(app)
    .delete(`/collections/${nonExistentCollection.name}/${nonExistentCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, 'No record found');
});

test.serial('DELETE successfully deletes if collection exists in PostgreSQL but not Elasticsearch', async (t) => {
  const {
    collectionPgModel,
    esCollectionClient,
    testKnex,
  } = t.context;
  const testCollection = fakeCollectionRecordFactory();
  await collectionPgModel.create(testKnex, testCollection);
  t.true(await collectionPgModel.exists(testKnex, {
    name: testCollection.name,
    version: testCollection.version,
  }));
  t.false(
    await esCollectionClient.exists(
      constructCollectionId(testCollection.name, testCollection.version)
    )
  );

  await request(app)
    .delete(`/collections/${testCollection.name}/${testCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(
    await collectionPgModel.exists(t.context.testKnex, {
      name: testCollection.name,
      version: testCollection.version,
    })
  );
  t.false(
    await esCollectionClient.exists(
      constructCollectionId(testCollection.name, testCollection.version)
    )
  );
});

test.serial('DELETE successfully deletes if collection exists in Elasticsearch but not PostgreSQL', async (t) => {
  const {
    collectionPgModel,
    esClient,
    esCollectionClient,
    testKnex,
  } = t.context;
  const testCollection = fakeCollectionFactory();
  await indexCollection(esClient, testCollection, process.env.ES_INDEX);
  t.false(await collectionPgModel.exists(testKnex, {
    name: testCollection.name,
    version: testCollection.version,
  }));
  t.true(
    await esCollectionClient.exists(
      constructCollectionId(testCollection.name, testCollection.version)
    )
  );

  await request(app)
    .delete(`/collections/${testCollection.name}/${testCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(
    await collectionPgModel.exists(t.context.testKnex, {
      name: testCollection.name,
      version: testCollection.version,
    })
  );
  t.false(
    await esCollectionClient.exists(
      constructCollectionId(testCollection.name, testCollection.version)
    )
  );
});

test.serial('Deleting a collection removes it from all data stores and publishes an SNS message', async (t) => {
  const { originalCollection } = await createCollectionTestRecords(t.context);

  t.true(
    await t.context.collectionModel.exists(
      originalCollection.name,
      originalCollection.version
    )
  );
  t.true(await t.context.collectionPgModel.exists(t.context.testKnex, {
    name: originalCollection.name,
    version: originalCollection.version,
  }));
  t.true(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalCollection.name, originalCollection.version)
    )
  );

  await request(app)
    .delete(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(
    await t.context.collectionModel.exists(
      originalCollection.name,
      originalCollection.version
    )
  );
  t.false(await t.context.collectionPgModel.exists(t.context.testKnex, {
    name: originalCollection.name,
    version: originalCollection.version,
  }));
  t.false(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalCollection.name, originalCollection.version)
    )
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const message = JSON.parse(JSON.parse(Messages[0].Body).Message);
  t.is(message.event, 'Delete');
  t.true(Date.now() > message.deletedAt);
  t.deepEqual(
    message.record,
    { name: originalCollection.name, version: originalCollection.version }
  );
});

test.serial('Attempting to delete a collection with an associated rule returns a 409 response', async (t) => {
  const { originalCollection } = await createCollectionTestRecords(t.context);

  const rule = fakeRuleFactoryV2({
    collection: {
      name: originalCollection.name,
      version: originalCollection.version,
    },
    rule: {
      type: 'onetime',
    },
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({}),
  });

  const ruleWithTrigger = await ruleModel.createRuleTrigger(rule);
  await ruleModel.create(ruleWithTrigger);

  const response = await request(app)
    .delete(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.is(response.body.message, `Cannot delete collection with associated rules: ${rule.name}`);
});

test.serial('Attempting to delete a collection with an associated rule does not delete the provider', async (t) => {
  const { collectionModel } = t.context;
  const { originalCollection } = await createCollectionTestRecords(t.context);

  const rule = fakeRuleFactoryV2({
    collection: {
      name: originalCollection.name,
      version: originalCollection.version,
    },
    rule: {
      type: 'onetime',
    },
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({}),
  });

  const ruleWithTrigger = await ruleModel.createRuleTrigger(rule);
  await ruleModel.create(ruleWithTrigger);

  await request(app)
    .delete(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.true(await collectionModel.exists(originalCollection.name, originalCollection.version));
});

test.serial('del() does not remove from PostgreSQL/Elasticsearch or publish SNS message if removing from Dynamo fails', async (t) => {
  const {
    originalCollection,
  } = await createCollectionTestRecords(
    t.context
  );

  const fakeCollectionsModel = {
    get: () => Promise.resolve(originalCollection),
    delete: () => {
      throw new Error('something bad');
    },
    create: () => Promise.resolve(true),
  };

  const expressRequest = {
    params: {
      name: originalCollection.name,
      version: originalCollection.version,
    },
    body: originalCollection,
    testContext: {
      knex: t.context.testKnex,
      collectionsModel: fakeCollectionsModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.collectionModel.get({
      name: originalCollection.name,
      version: originalCollection.version,
    }),
    originalCollection
  );
  t.true(
    await t.context.collectionPgModel.exists(t.context.testKnex, {
      name: originalCollection.name,
      version: originalCollection.version,
    })
  );
  t.true(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalCollection.name, originalCollection.version)
    )
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});

test.serial('del() does not remove from Dynamo/Elasticsearch or publish SNS message if removing from PostgreSQL fails', async (t) => {
  const {
    originalCollection,
    originalPgRecord,
  } = await createCollectionTestRecords(
    t.context
  );

  const fakeCollectionPgModel = {
    delete: () => {
      throw new Error('something bad');
    },
    get: () => Promise.resolve(originalPgRecord),
  };

  const expressRequest = {
    params: {
      name: originalCollection.name,
      version: originalCollection.version,
    },
    body: originalCollection,
    testContext: {
      knex: t.context.testKnex,
      collectionPgModel: fakeCollectionPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.collectionModel.get({
      name: originalCollection.name,
      version: originalCollection.version,
    }),
    originalCollection
  );
  t.true(
    await t.context.collectionPgModel.exists(t.context.testKnex, {
      name: originalCollection.name,
      version: originalCollection.version,
    })
  );
  t.true(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalCollection.name, originalCollection.version)
    )
  );
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});

test.serial('del() does not remove from Dynamo/PostgreSQL or publish SNS message if removing from Elasticsearch fails', async (t) => {
  const {
    originalCollection,
  } = await createCollectionTestRecords(
    t.context
  );

  const fakeEsClient = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      name: originalCollection.name,
      version: originalCollection.version,
    },
    body: originalCollection,
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
    await t.context.collectionModel.get({
      name: originalCollection.name,
      version: originalCollection.version,
    }),
    originalCollection
  );
  t.true(
    await t.context.collectionPgModel.exists(t.context.testKnex, {
      name: originalCollection.name,
      version: originalCollection.version,
    })
  );
  t.true(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalCollection.name, originalCollection.version)
    )
  );
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});
