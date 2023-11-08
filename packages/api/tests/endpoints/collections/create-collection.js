'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const awsServices = require('@cumulus/aws-client/services');
const { sendSNSMessage } = require('@cumulus/aws-client/SNS');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv,
  generateLocalTestDb,
  destroyLocalTestDb,
  CollectionPgModel,
  migrationDir,
  translateApiCollectionToPostgresCollection,
  translatePostgresCollectionToApiCollection,
} = require('@cumulus/db');
const { sqs } = require('@cumulus/aws-client/services');
const {
  constructCollectionId,
} = require('@cumulus/message/Collections');
const EsCollection = require('@cumulus/es-client/collections');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const CollectionConfigStore = require('@cumulus/collection-config-store');
const AccessToken = require('../../../models/access-tokens');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');

const assertions = require('../../../lib/assertions');
const { post } = require('../../../endpoints/collections');
const { buildFakeExpressResponse } = require('../utils');

process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let jwtAuthToken;
let accessTokenModel;

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

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.beforeEach(async (t) => {
  const topicName = randomString();
  const { TopicArn } = sendSNSMessage({ Name: topicName }, 'CreateTopicCommand');
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
  const { SubscriptionArn } = sendSNSMessage({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
    ReturnSubscriptionArn: true,
  }, 'SubscribeCommand');

  sendSNSMessage({
    TopicArn,
    Token: SubscriptionArn,
  }, 'ConfirmSubscriptionCommand');
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl }).promise();
  sendSNSMessage({ TopicArn }, 'DeleteTopicCommand');
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await cleanupTestIndex(t.context);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const newCollection = fakeCollectionFactory();
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, res);
});

test('CUMULUS-912 POST with an invalid access token returns an unauthorized response', async (t) => {
  const newCollection = fakeCollectionFactory();
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);
  assertions.isInvalidAccessTokenResponse(t, res);
});

test.todo('CUMULUS-912 POST with an unauthorized user returns an unauthorized response');

test('POST with invalid authorization scheme returns an invalid token response', async (t) => {
  const newCollection = fakeCollectionFactory();
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', 'InvalidBearerScheme ThisIsAnInvalidAuthorizationToken')
    .expect(401);
  assertions.isInvalidAuthorizationResponse(t, res);
});

test.serial('POST creates a new collection in all data stores and publishes an SNS message', async (t) => {
  const newCollection = fakeCollectionFactory();

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const fetchedPgRecord = await t.context.collectionPgModel.get(
    t.context.testKnex,
    {
      name: newCollection.name,
      version: newCollection.version,
    }
  );

  t.is(fetchedPgRecord.name, newCollection.name);
  t.is(fetchedPgRecord.version, newCollection.version);

  const translatedCollection = translatePostgresCollectionToApiCollection(fetchedPgRecord);

  t.is(res.body.message, 'Record saved');
  t.like(res.body.record, translatedCollection);

  const esRecord = await t.context.esCollectionClient.get(
    constructCollectionId(newCollection.name, newCollection.version)
  );
  t.like(esRecord, translatedCollection);

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const message = JSON.parse(JSON.parse(Messages[0].Body).Message);
  t.is(message.event, 'Create');
  t.deepEqual(message.record, translatedCollection);
});

test.serial('POST creates a new collection in all data stores with correct timestamps', async (t) => {
  const newCollection = fakeCollectionFactory();

  await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const collectionPgRecord = await t.context.collectionPgModel.get(
    t.context.testKnex,
    {
      name: newCollection.name,
      version: newCollection.version,
    }
  );

  const esRecord = await t.context.esCollectionClient.get(
    constructCollectionId(newCollection.name, newCollection.version)
  );

  t.true(collectionPgRecord.created_at.getTime() > newCollection.createdAt);
  t.true(collectionPgRecord.updated_at.getTime() > newCollection.updatedAt);
  // Records have the same timestamps
  t.is(collectionPgRecord.created_at.getTime(), esRecord.createdAt);
  t.is(collectionPgRecord.updated_at.getTime(), esRecord.updatedAt);
});

test.serial('POST creates collection configuration store via name and version', async (t) => {
  const newCollection = fakeCollectionFactory();

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const fetchedPgRecord = await t.context.collectionPgModel.get(
    t.context.testKnex,
    {
      name: newCollection.name,
      version: newCollection.version,
    }
  );

  t.is(fetchedPgRecord.name, newCollection.name);
  t.is(fetchedPgRecord.version, newCollection.version);

  const collectionConfigStore = new CollectionConfigStore(
    process.env.system_bucket,
    process.env.stackName
  );
  t.deepEqual(await collectionConfigStore.get(fetchedPgRecord.name, fetchedPgRecord.version),
    res.body.record);
});

test.serial('POST without a name returns a 400 error', async (t) => {
  const newCollection = fakeCollectionFactory();
  delete newCollection.name;

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  const { message } = res.body;
  t.is(message, `Field name and/or version is missing in Collection payload ${JSON.stringify(newCollection)}`);
});

test.serial('POST without a version returns a 400 error', async (t) => {
  const newCollection = fakeCollectionFactory();
  delete newCollection.version;

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  const { message } = res.body;
  t.is(message, `Field name and/or version is missing in Collection payload ${JSON.stringify(newCollection)}`);
});

test('POST for an existing collection returns a 409', async (t) => {
  const { collectionPgModel, testKnex } = t.context;
  const newCollection = fakeCollectionFactory();
  await collectionPgModel.create(
    testKnex,
    await translateApiCollectionToPostgresCollection(newCollection)
  );

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);
  t.is(res.status, 409);
  t.is(res.body.message, `A record already exists for name: ${newCollection.name}, version: ${newCollection.version}`);
});

test.serial('POST with non-matching granuleIdExtraction regex returns 400 bad request response', async (t) => {
  const newCollection = fakeCollectionFactory();

  newCollection.granuleIdExtraction = 'badregex';
  newCollection.sampleFileName = 'filename.txt';

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(res.status, 400);
  t.is(res.body.message, 'granuleIdExtraction "badregex" cannot validate "filename.txt"');
});

test.serial('POST with non-matching file.regex returns 400 bad request repsonse', async (t) => {
  const newCollection = fakeCollectionFactory();
  const filename = 'filename.txt';
  const regex = 'badregex';

  newCollection.files = [{
    regex,
    sampleFileName: filename,
    bucket: randomString(),
  }];

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(res.status, 400);
  t.is(res.body.message, `regex "${regex}" cannot validate "${filename}"`);
});

test.serial('POST returns a 500 response if record creation throws unexpected error', async (t) => {
  const stub = sinon.stub(CollectionPgModel.prototype, 'create')
    .callsFake(() => {
      throw new Error('unexpected error');
    });

  const newCollection = fakeCollectionFactory();

  try {
    const response = await request(app)
      .post('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(newCollection)
      .expect(500);
    t.is(response.status, 500);
  } finally {
    stub.restore();
  }
});

test.serial('POST with invalid granuleIdExtraction regex returns 400 bad request', async (t) => {
  const newCollection = fakeCollectionFactory({
    granuleIdExtraction: '*',
  });

  const response = await request(app)
    .post('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newCollection)
    .expect(400);
  t.is(response.status, 400);
  t.true(response.body.message.includes('Invalid granuleIdExtraction'));
});

test.serial('POST with invalid file.regex returns 400 bad request', async (t) => {
  const newCollection = fakeCollectionFactory({
    files: [{
      bucket: 'test-bucket',
      regex: '*',
      sampleFileName: 'filename',
    }],
  });

  const response = await request(app)
    .post('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newCollection)
    .expect(400);
  t.is(response.status, 400);
  t.true(response.body.message.includes('Invalid regex'));
});

test.serial('POST with invalid granuleId regex returns 400 bad request', async (t) => {
  const newCollection = fakeCollectionFactory({
    granuleId: '*',
  });

  const response = await request(app)
    .post('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newCollection)
    .expect(400);
  t.is(response.status, 400);
  t.true(response.body.message.includes('Invalid granuleId'));
});

test.serial('POST with non-matching granuleId regex returns 400 bad request response', async (t) => {
  const newCollection = fakeCollectionFactory({
    granuleIdExtraction: '(filename)',
    sampleFileName: 'filename',
    granuleId: 'badregex',
  });

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(res.status, 400);
  t.true(res.body.message.includes('granuleId "badregex" cannot validate "filename"'));
});

test.serial('POST with non-matching group granuleIdExtraction regex returns 400 bad request response', async (t) => {
  const newCollection = fakeCollectionFactory({
    granuleIdExtraction: '1234',
    sampleFileName: '1234',
  });
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(res.status, 400);
  t.true(res.body.message.includes('granuleIdExtraction regex "1234" does not return a matched group when applied to sampleFileName "1234"'));
});

test.serial('POST with unmatched file.checksumFor returns 400 bad request response', async (t) => {
  const newCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename',
      checksumFor: '^1234$',
    }],
  });
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(res.status, 400);
  t.true(res.body.message.includes('checksumFor \'^1234$\' does not match any file regex'));
});

test.serial('POST with file.checksumFor matching multiple files returns 400 bad request response', async (t) => {
  const newCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename',
    },
    {
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename2',
    },
    {
      bucket: 'bucket',
      regex: '^file.*$',
      sampleFileName: 'filename3',
      checksumFor: '^.*$',
    }],
  });
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(res.status, 400);
  t.true(res.body.message.includes('checksumFor \'^.*$\' matches multiple file regexes'));
});

test.serial('POST with file.checksumFor matching its own file returns 400 bad request response', async (t) => {
  const newCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename',
      checksumFor: '^.*$',
    }],
  });
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(res.status, 400);
  t.true(res.body.message.includes('checksumFor \'^.*$\' cannot be used to validate itself'));
});

test.serial('POST does not write to Elasticsearch/SNS if writing to PostgreSQL fails', async (t) => {
  const collection = fakeCollectionFactory();

  const fakeCollectionPgModel = {
    create: () => Promise.reject(new Error('something bad')),
  };

  const expressRequest = {
    body: collection,
    testContext: {
      collectionPgModel: fakeCollectionPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  t.true(response.boom.badImplementation.calledWithMatch('something bad'));

  t.false(await t.context.esCollectionClient.exists(
    constructCollectionId(collection.name, collection.version)
  ));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});

test.serial('POST does not write to PostgreSQL/SNS if writing to Elasticsearch fails', async (t) => {
  const collection = fakeCollectionFactory();

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const expressRequest = {
    body: collection,
    testContext: {
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  t.true(response.boom.badImplementation.calledWithMatch('something bad'));

  t.false(
    await t.context.collectionPgModel.exists(t.context.testKnex, {
      name: collection.name,
      version: collection.version,
    })
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});
