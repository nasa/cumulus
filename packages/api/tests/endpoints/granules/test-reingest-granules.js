'use strict';

const request = require('supertest');
const sinon = require('sinon');
const test = require('ava');

const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv,
  generateLocalTestDb,
  destroyLocalTestDb,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  GranulePgModel,
  migrationDir,
} = require('@cumulus/db');

const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../../lib/testUtils');
const models = require('../../../models');
const { app } = require('../../../app');

process.env.AccessTokensTable = randomString();
process.env.backgroundQueueUrl = randomString();
process.env.GranulesTable = randomString();
process.env.TOKEN_SECRET = randomString();

let accessTokenModel;
let jwtAuthToken;

const testDbName = randomString(12);

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  const collectionPgModel = new CollectionPgModel();
  const granulePgModel = new GranulePgModel();

  const fakeCollection = fakeCollectionRecordFactory({ name: 'FakeCollection', version: '006' });
  const [collectionPgRecord] = await collectionPgModel.create(t.context.knex, fakeCollection);
  const collectionCumulusId = collectionPgRecord.cumulus_id;

  const fakeGranule = fakeGranuleRecordFactory(
    {
      granule_id: randomId('granule'),
      status: 'completed',
      collection_cumulus_id: collectionCumulusId,
      published: true,
      cmr_link: 'https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=G1224390942-PO_NGP_UAT',
    }
  );

  const [granuleCumulusId] = await granulePgModel.create(knex, fakeGranule);
  const pgGranule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });
  t.context.granuleId = pgGranule.granule_id;

  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('put request with reingest action calls the granuleModel.reingest function with expected parameters', async (t) => {
  const {
    granuleId,
  } = t.context;

  const granuleReingestStub = sinon.stub(models.Granule.prototype, 'reingest').returns(
    new Promise((resolve) => resolve({ response: 'fakeResponse' }))
  );

  const body = {
    action: 'reingest',
  };

  await request(app)
    .put(`/granules/${granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(200);

  t.is(granuleReingestStub.calledOnce, true);

  const reingestArgs = granuleReingestStub.args[0];
  const { queueUrl } = reingestArgs[0];
  t.is(queueUrl, process.env.backgroundQueueUrl);

  granuleReingestStub.restore();
});
