'use strict';

const request = require('supertest');
const test = require('ava');

const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { Search } = require('../../es/search');
const bootstrap = require('../../lambdas/bootstrap');
const models = require('../../models');
const indexer = require('../../es/indexer');
const assertions = require('../../lib/assertions');

const {
  fakeAccessTokenFactory,
  fakeGranuleFactoryV2,
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers
} = require('../../lib/testUtils');
const { createJwtToken } = require('../../lib/token');
const { app } = require('../../app');


process.env.AccessTokensTable = randomId('token');
process.env.GranulesTable = randomId('granules');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system_bucket');
process.env.TOKEN_SECRET = randomId('secret');

const createBucket = (Bucket) => awsServices.s3().createBucket({ Bucket }).promise();

// create all the variables needed across this test
let esClient;
let esIndex;
let accessTokenModel;
let granuleModel;
let accessToken;
let fakeGranules;

test.before(async () => {
  esIndex = randomId('esindex');
  const esAlias = randomId('esAlias');
  process.env.ES_HOST = esAlias;

  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create fake Granules table
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  const username = randomId();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  accessToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  // create fake granule records
  fakeGranules = [
    fakeGranuleFactoryV2({ status: 'completed', beginningDateTime: '177204', endingDateTime: '132948' }),
    fakeGranuleFactoryV2({ status: 'failed', beginningDateTime: '177205', endingDateTime: '132949' })
  ];

  await Promise.all(fakeGranules.map((granule) =>
    granuleModel.create(granule)
      .then((record) => indexer.indexGranule(esClient, record, esIndex))));
});

test.after.always(async () => {
  await granuleModel.deleteTable();
  await accessTokenModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/granule-csv')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('GET with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/granule-csv')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('GET with an unauthorized user returns an unauthorized response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  await accessTokenModel.create(accessTokenRecord);
  const jwtToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/granule-csv')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtToken}`)
    .expect(401);

  assertions.isUnauthorizedUserResponse(t, response);
});

test('GET returns a cvs file of all granules', async (t) => {
  const response = await request(app)
    .get('/granule-csv')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);

  const lines = response.text.split('\n');
  t.is(response.status, 200);
  t.is(lines[0], '"granuleUr","collectionId","createdAt","startDateTime","endDateTime"');
  fakeGranules.forEach((g) => {
    const line = lines.filter((l) => l.includes(g.granuleId))[0];
    const createdDate = new Date(g.createdAt);
    t.true(line.includes(g.granuleId));
    t.true(line.includes(g.collectionId));
    t.true(line.includes(g.beginningDateTime));
    t.true(line.includes(g.endingDateTime));
    t.true(line.includes(createdDate.toISOString()));
  });
});
