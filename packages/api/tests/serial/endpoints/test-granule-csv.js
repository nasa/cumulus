'use strict';

const request = require('supertest');
const test = require('ava');

const aws = require('@cumulus/common/aws');
const { randomId } = require('@cumulus/common/test-utils');

const { Search } = require('../../../es/search');
const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const indexer = require('../../../es/indexer');

const {
  fakeGranuleFactoryV2,
  createFakeJwtAuthToken
} = require('../../../lib/testUtils');
const { app } = require('../../../app');


process.env.AccessTokensTable = randomId('token');
// process.env.CollectionsTable = randomId('collection');
process.env.GranulesTable = randomId('granules');
process.env.UsersTable = randomId('users');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system_bucket');
process.env.TOKEN_SECRET = randomId('secret');

const createBucket = (Bucket) => aws.s3().createBucket({ Bucket }).promise();

// create all the variables needed across this test
let esClient;
let esIndex;
let accessTokenModel;
let granuleModel;
let accessToken;
let userModel;

test.before(async () => {
  esIndex = randomId('esindex');
  process.env.esIndex = esIndex;

  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create fake Granules table
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  // create fake Users table
  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  accessToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.beforeEach(async (t) => {
  // create fake granule records
  t.context.fakeGranules = [
    fakeGranuleFactoryV2({ status: 'completed' }),
    fakeGranuleFactoryV2({ status: 'failed' })
  ];

  await Promise.all(t.context.fakeGranules.map((granule) =>
    granuleModel.create(granule)
      .then((record) => indexer.indexGranule(esClient, record, esIndex))));
});

test.after.always(async () => {
  await granuleModel.deleteTable();
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('GET returns a cvs file of all granules', async (t) => {
  const response = await request(app)
    .get('/granule-csv')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);

  const granuleIds = t.context.fakeGranules.map((g) => g.granuleId);
  t.is(response.status, 200);
  t.true(response.text.includes('"granuleUr","collectionId","createdAt","startDateTime","endDateTime"'));
  granuleIds.forEach((gId) => {
    t.true(response.text.includes(gId));
  });
});
