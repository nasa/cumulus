'use strict';

const test = require('ava');
const request = require('supertest');
const awsServices = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const bootstrap = require('../../lambdas/bootstrap');
const indexer = require('../../es/indexer');
const {
  createFakeJwtAuthToken,
  fakePdrFactory,
  setAuthorizedOAuthUsers
} = require('../../lib/testUtils');
const { Search } = require('../../es/search');
const assertions = require('../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.PdrsTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

const pdrS3Key = (pdrName) => `${process.env.stackName}/pdrs/${pdrName}`;

const uploadPdrToS3 = (bucket, pdrName, pdrBody) =>
  awsServices.s3().putObject({
    Bucket: bucket,
    Key: pdrS3Key(pdrName),
    Body: pdrBody
  }).promise();

// create all the variables needed across this test
let esClient;
let fakePdrs;
const esIndex = randomString();

let jwtAuthToken;
let accessTokenModel;
let pdrModel;

test.before(async () => {
  // create esClient
  esClient = await Search.es('fakehost');

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  // create a fake bucket
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  pdrModel = new models.Pdr();
  await pdrModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  // create fake PDR records
  fakePdrs = ['completed', 'failed'].map(fakePdrFactory);
  await Promise.all(
    fakePdrs.map(
      (pdr) => pdrModel.create(pdr)
        .then((record) => indexer.indexPdr(esClient, record, esAlias))
    )
  );
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await pdrModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/pdrs')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/pdrs/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .delete('/pdrs/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/pdrs')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('CUMULUS-912 GET with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/pdrs/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 DELETE with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/pdrs/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 DELETE with pathParameters and with an unauthorized user returns an unauthorized response');

test('default returns list of pdrs', async (t) => {
  const response = await request(app)
    .get('/pdrs')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 2);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'pdr');
  t.is(meta.count, 2);
  const pdrNames = fakePdrs.map((i) => i.pdrName);
  results.forEach((r) => {
    t.true(pdrNames.includes(r.pdrName));
  });
});

test('GET returns an existing pdr', async (t) => {
  const response = await request(app)
    .get(`/pdrs/${fakePdrs[0].pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { pdrName } = response.body;
  t.is(pdrName, fakePdrs[0].pdrName);
});

test('GET fails if pdr is not found', async (t) => {
  const response = await request(app)
    .get('/pdrs/unknownpdr')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  const { message } = response.body;
  t.true(message.includes('No record found for'));
});

test('DELETE a pdr', async (t) => {
  const newPdr = fakePdrFactory('completed');
  // create a new pdr
  await pdrModel.create(newPdr);

  const key = `${process.env.stackName}/pdrs/${newPdr.pdrName}`;
  await awsServices.s3().putObject({ Bucket: process.env.system_bucket, Key: key, Body: 'test data' }).promise();

  const response = await request(app)
    .delete(`/pdrs/${newPdr.pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const { detail } = response.body;
  t.is(detail, 'Record deleted');
});

test('DELETE handles the case where the PDR exists in S3 but not in DynamoDb', async (t) => {
  const pdrName = `${randomString()}.PDR`;

  await uploadPdrToS3(
    process.env.system_bucket,
    pdrName,
    'This is the PDR body'
  );

  const response = await request(app)
    .delete(`/pdrs/${pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);

  const parsedBody = response.body;
  t.is(parsedBody.detail, 'Record deleted');
});

test('DELETE handles the case where the PDR exists in DynamoDb but not in S3', async (t) => {
  const newPdr = fakePdrFactory('completed');
  await pdrModel.create(newPdr);

  const response = await request(app)
    .delete(`/pdrs/${newPdr.pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);

  const parsedBody = response.body;
  t.is(parsedBody.detail, 'Record deleted');
});
