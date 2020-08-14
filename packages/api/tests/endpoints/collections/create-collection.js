'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const AccessToken = require('../../../models/access-tokens');
const Collection = require('../../../models/collections');
const bootstrap = require('../../../lambdas/bootstrap');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.CollectionsTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;
let collectionModel;
let publishStub;

test.before(async () => {
  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  collectionModel = new Collection({ tableName: process.env.CollectionsTable });
  await collectionModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  esClient = await Search.es('fakehost');

  process.env.collection_sns_topic_arn = randomString();
  publishStub = sinon.stub(awsServices.sns(), 'publish').returns({
    promise: async () => true,
  });
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await collectionModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
  publishStub.restore();
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

test('POST creates a new collection', async (t) => {
  const newCollection = fakeCollectionFactory();
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message, record } = res.body;
  t.is(message, 'Record saved');
  t.is(record.name, newCollection.name);
});

test('POST without a name returns a 400 error', async (t) => {
  const newCollection = fakeCollectionFactory();
  delete newCollection.name;

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  const { message } = res.body;
  t.is(message, 'Field name and/or version is missing');
});

test('POST without a version returns a 400 error', async (t) => {
  const newCollection = fakeCollectionFactory();
  delete newCollection.version;

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  const { message } = res.body;
  t.is(message, 'Field name and/or version is missing');
});

test('POST for an existing collection returns a 409', async (t) => {
  const newCollection = fakeCollectionFactory();

  await collectionModel.create(newCollection);

  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);
  t.is(res.status, 409);
  t.is(res.body.message, `A record already exists for ${newCollection.name} version: ${newCollection.version}`);
});

test('POST with non-matching granuleIdExtraction regex returns 400 bad request response', async (t) => {
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

test('POST with non-matching file.regex returns 400 bad request repsonse', async (t) => {
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
  const stub = sinon.stub(Collection.prototype, 'create')
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

test('POST with invalid granuleIdExtraction regex returns 400 bad request', async (t) => {
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

test('POST with invalid file.regex returns 400 bad request', async (t) => {
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

test('POST with invalid granuleId regex returns 400 bad request', async (t) => {
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

test('POST with non-matching granuleId regex returns 400 bad request response', async (t) => {
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
