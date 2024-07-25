'use strict';

const test = require('ava');
const request = require('supertest');
const { s3, sns, sqs } = require('@cumulus/aws-client/services');
const {
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  translatePostgresCollectionToApiCollection,
} = require('@cumulus/db');
const CollectionConfigStore = require('@cumulus/collection-config-store');
const {
  InvalidRegexError,
  UnmatchedRegexError,
} = require('@cumulus/errors');

const { AccessToken } = require('../../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  createCollectionTestRecords,
  fakeCollectionFactory,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');
const { put } = require('../../../endpoints/collections');

const { buildFakeExpressResponse } = require('../utils');

process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let jwtAuthToken;
let accessTokenModel;

const testDbName = randomString(12);
process.env = {
  ...process.env,
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

test.before(async (t) => {
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.collectionPgModel = new CollectionPgModel();

  await s3().createBucket({ Bucket: process.env.system_bucket });
  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});
test.beforeEach(async (t) => {
  const topicName = randomString();
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.collection_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await sqs().createQueue({ QueueName });
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  });
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().send(new SubscribeCommand({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }));

  t.context.SubscriptionArn = SubscriptionArn;
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl });
  await sns().send(new DeleteTopicCommand({ TopicArn }));
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

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .put('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('PUT replaces an existing collection and sends an SNS message', async (t) => {
  const {
    originalCollection,
    originalPgRecord,
  } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'replace',
      process: randomString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  );

  const updatedCollection = {
    ...originalCollection,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    duplicateHandling: 'error',
  };
  delete updatedCollection.process;

  await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const actualPgCollection = await t.context.collectionPgModel.get(t.context.testKnex, {
    name: originalCollection.name,
    version: originalCollection.version,
  });

  t.deepEqual(actualPgCollection, {
    ...originalPgRecord,
    duplicate_handling: 'error',
    process: null,
    created_at: originalPgRecord.created_at,
    updated_at: actualPgCollection.updated_at,
  });

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  });

  t.is(Messages.length, 1);

  const message = JSON.parse(JSON.parse(Messages[0].Body).Message);
  t.is(message.event, 'Update');
  t.deepEqual(message.record, translatePostgresCollectionToApiCollection(actualPgCollection));
});

test.serial('PUT replaces an existing collection and correctly removes fields', async (t) => {
  const origProcess = randomString();

  const {
    originalCollection,
    originalPgRecord,
  } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'replace',
      process: origProcess,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  );

  t.is(originalCollection.process, origProcess);
  t.is(originalPgRecord.process, origProcess);

  const updatedCollection = {
    ...originalCollection,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    duplicateHandling: 'error',
  };
  // remove the "process" field
  delete updatedCollection.process;

  await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const actualPgCollection = await t.context.collectionPgModel.get(t.context.testKnex, {
    name: originalCollection.name,
    version: originalCollection.version,
  });

  t.deepEqual(actualPgCollection, {
    ...originalPgRecord,
    duplicate_handling: 'error',
    process: null,
    created_at: originalPgRecord.created_at,
    updated_at: actualPgCollection.updated_at,
  });
});

test.serial('PUT replaces an existing collection with correct timestamps', async (t) => {
  const { originalCollection } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'replace',
      process: randomString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  );

  const updatedCollection = {
    ...originalCollection,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    duplicateHandling: 'error',
  };

  await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const actualPgCollection = await t.context.collectionPgModel.get(t.context.testKnex, {
    name: originalCollection.name,
    version: originalCollection.version,
  });

  // Endpoint logic will set an updated timestamp and ignore the value from the request
  // body, so value on actual records should be different (greater) than the value
  // sent in the request body
  t.true(actualPgCollection.updated_at.getTime() > updatedCollection.updatedAt);
  // createdAt timestamp from original record should have been preserved
  t.is(actualPgCollection.created_at.getTime(), originalCollection.createdAt);
});

test.serial('PUT updates collection configuration store via name and version', async (t) => {
  const { originalCollection } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'replace',
      process: randomString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      meta: { foo: randomString() },
    }
  );

  const updatedCollection = {
    ...originalCollection,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    duplicateHandling: 'error',
    meta: { foo: { nestedKey: randomString() } },
  };

  const res = await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const collectionConfigStore = new CollectionConfigStore(
    process.env.system_bucket,
    process.env.stackName
  );

  t.deepEqual(await collectionConfigStore.get(originalCollection.name, originalCollection.version),
    res.body);
});

test.serial('PUT returns 404 for non-existent collection', async (t) => {
  const originalCollection = fakeCollectionFactory();
  const response = await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(originalCollection)
    .expect(404);
  const { message, record } = response.body;

  t.truthy(message);
  t.falsy(record);
});

test.serial('PUT returns 400 for name mismatch between params and payload', async (t) => {
  const originalCollection = fakeCollectionFactory();
  const response = await request(app)
    .put(`/collections/${randomString()}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(originalCollection)
    .expect(400);
  const { message, record } = response.body;

  t.truthy(message);
  t.falsy(record);
});

test.serial('PUT returns 400 for version mismatch between params and payload', async (t) => {
  const originalCollection = fakeCollectionFactory();
  const response = await request(app)
    .put(`/collections/${originalCollection.name}/${randomString()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(originalCollection)
    .expect(400);
  const { message, record } = response.body;

  t.truthy(message);
  t.falsy(record);
});

test.serial('PUT throws InvalidRegexError for invalid granuleIdExtraction', async (t) => {
  const updateCollection = fakeCollectionFactory({ granuleIdExtraction: '*' });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    { instanceOf: InvalidRegexError }
  );
});

test.serial('PUT throws UnmatchedRegexError for non-matching granuleIdExtraction', async (t) => {
  const updateCollection = fakeCollectionFactory({
    granuleIdExtraction: '(1234)',
    sampleFileName: 'abcd',
  });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    { instanceOf: UnmatchedRegexError }
  );
});

test.serial('PUT throws UnmatchedRegexError for granuleIdExtraction with no matching group', async (t) => {
  const updateCollection = fakeCollectionFactory({
    granuleIdExtraction: '1234',
    sampleFileName: '1234',
  });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    { instanceOf: UnmatchedRegexError }
  );
});

test.serial('PUT throws InvalidRegexError for invalid granuleId regex', async (t) => {
  const updateCollection = fakeCollectionFactory({ granuleId: '*' });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    { instanceOf: InvalidRegexError }
  );
});

test.serial('PUT throws UnmatchedRegexError for non-matching granuleId regex', async (t) => {
  const updateCollection = fakeCollectionFactory({
    granuleIdExtraction: '(1234)',
    sampleFileName: '1234',
    granuleId: 'abcd',
  });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    { instanceOf: UnmatchedRegexError }
  );
});

test.serial('PUT throws InvalidRegexError for invalid file.regex', async (t) => {
  const updateCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '*',
      sampleFileName: 'filename',
    }],
  });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    { instanceOf: InvalidRegexError }
  );
});

test.serial('PUT throws UnmatchedRegexError for non-matching file.regex', async (t) => {
  const updateCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^1234$',
      sampleFileName: 'filename',
    }],
  });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    { instanceOf: UnmatchedRegexError }
  );
});

test.serial('PUT throws UnmatchedRegexError for unmatched file.checksumFor', async (t) => {
  const updateCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename',
      checksumFor: '^1234$',
    }],
  });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    {
      instanceOf: UnmatchedRegexError,
      message: 'checksumFor \'^1234$\' does not match any file regex',
    }
  );
});

test.serial('PUT throws InvalidRegexError for file.checksumFor matching multiple files', async (t) => {
  const updateCollection = fakeCollectionFactory({
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
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    {
      instanceOf: InvalidRegexError,
      message: 'checksumFor \'^.*$\' matches multiple file regexes',
    }
  );
});

test.serial('PUT throws InvalidRegexError for file.checksumFor matching its own file', async (t) => {
  const updateCollection = fakeCollectionFactory({
    files: [{
      bucket: 'bucket',
      regex: '^.*$',
      sampleFileName: 'filename',
      checksumFor: '^.*$',
    }],
  });
  const validateRequest = {
    params: {
      name: updateCollection.name,
      version: updateCollection.version,
    },
    body: updateCollection,
  };
  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(validateRequest, response),
    {
      instanceOf: InvalidRegexError,
      message: 'checksumFor \'^.*$\' cannot be used to validate itself',
    }
  );
});
