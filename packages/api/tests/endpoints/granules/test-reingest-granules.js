'use strict';

const sinon = require('sinon');
const test = require('ava');

const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
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

const { setAuthorizedOAuthUsers } = require('../../../lib/testUtils');
const models = require('../../../models');
const { patch } = require('../../../endpoints/granules');
const { buildFakeExpressResponse } = require('../utils');

process.env.AccessTokensTable = randomString();
process.env.backgroundQueueUrl = randomString();
process.env.TOKEN_SECRET = randomString();

let accessTokenModel;

const testDbName = randomString(12);

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
  const { knex, knexAdmin } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  const collectionPgModel = new CollectionPgModel();
  const granulePgModel = new GranulePgModel();

  const fakeCollection = fakeCollectionRecordFactory({
    name: 'FakeCollection',
    version: '006',
  });
  const [collectionPgRecord] = await collectionPgModel.create(
    t.context.knex,
    fakeCollection
  );
  t.context.collectionId = constructCollectionId(
    collectionPgRecord.name,
    collectionPgRecord.version
  );
  const collectionCumulusId = collectionPgRecord.cumulus_id;

  const fakeGranule = fakeGranuleRecordFactory({
    granule_id: randomId('granule'),
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
    published: true,
    cmr_link:
      'https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=G1224390942-PO_NGP_UAT',
  });

  const [createdPgGranule] = await granulePgModel.create(knex, fakeGranule);
  const pgGranule = await granulePgModel.get(knex, {
    cumulus_id: createdPgGranule.cumulus_id,
  });
  t.context.granuleId = pgGranule.granule_id;

  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();
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

test('PATCH request with reingest action queues granule and calls the reingestGranule function with expected parameters', async (t) => {
  const { granuleId, collectionId } = t.context;

  const granuleReingestStub = sinon
    .stub()
    .resolves({ response: 'fakeResponse' });
  const updateGranuleStatusToQueuedMethod = sinon.stub().resolves({});
  const body = {
    action: 'reingest',
  };

  await patch(
    {
      body,
      params: {
        granuleName: granuleId,
        collectionId,
      },
      testContext: {
        reingestHandler: granuleReingestStub,
        updateGranuleStatusToQueuedMethod,
      },
    },
    buildFakeExpressResponse()
  );

  t.is(granuleReingestStub.calledOnce, true);

  const { queueUrl } = granuleReingestStub.lastCall.args[0];
  const { apiGranule } = updateGranuleStatusToQueuedMethod.lastCall.args[0];
  t.is(apiGranule.granuleId, granuleId);
  t.is(queueUrl, process.env.backgroundQueueUrl);
});
