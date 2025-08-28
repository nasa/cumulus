'use strict';

const sinon = require('sinon');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const moment = require('moment');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { bulkArchive } = require('../../endpoints/granules');

const { range } = require('lodash');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let granulePgModel;

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

test.before(async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
  };

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create a workflow template file
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: tKey,
    Body: JSON.stringify({
      cumulus_meta: {
        cumulus_version: 'v0.0.0',
      },
    }),
  });

  // create a workflowKey
  const workflowKey = `${process.env.stackName}/workflows/ChangeGranuleCollectionsWorkflow.json`;

  t.context.workflowArn = 'fakeWorkflow';
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: workflowKey,
    Body: JSON.stringify({
      arn: t.context.workflowArn,
    }),
  });

  granulePgModel = new GranulePgModel();
  t.context.granulePgModel = granulePgModel;

  // Generate a local test postGres database

});

test.beforeEach(async (t) => {
  process.env.PG_DATABASE = testDbName;
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  t.context.collectionName = `fakeCollection${cryptoRandomString({ length: 6 })}`;
  t.context.collectionVersion = 'v1';

  t.context.collectionId = constructCollectionId(
    t.context.collectionName,
    t.context.collectionVersion
  );

  t.context.testPgCollection = fakeCollectionRecordFactory({
    name: t.context.collectionName,
    version: t.context.collectionVersion,
  });

  t.context.collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection
  );

  t.context.collectionCumulusId = pgCollection.cumulus_id;

  t.context.collectionId = constructCollectionId(pgCollection.name, pgCollection.version);

  // create fake Postgres granule records
  t.context.fakePGGranules = range(100).map((i) => fakeGranuleRecordFactory({
    updated_at: moment().subtract(i, 'd'),
    collection_cumulus_id: t.context.collectionCumulusId
  }));

  t.context.fakePGGranuleRecords = await Promise.all(
    t.context.fakePGGranules.map((granule) =>
      upsertGranuleWithExecutionJoinRecord({
        knexTransaction: t.context.knex,
        granule,
        executionCumulusId: t.context.testExecutionCumulusId,
        granulePgModel: t.context.granulePgModel,
      }))
  );
  t.context.insertedPgGranules = t.context.fakePGGranuleRecords.flat();
});

test.afterEach(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
})

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('archiveGranules archives granules more than 2 days old', async (t) => {
  const { knex } = t.context;
  const req = {
    body: {
      batchSize: 100,
      expirationDays: 2,
    },
    testContext: {
      knex,
      sfnMethod: () => ({
        getKnexClientMethod: () => knex,
      }),
    },
  };

  const res = {
    boom: {
      badRequest: sinon.stub(),
    },
    send: sinon.stub(),
  };
  const granuleModel = new GranulePgModel()

  await bulkArchive(req, res);
  const archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(async (fakeGranuleRecord) => (await granuleModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })).archived)
  );
  t.deepEqual(archivedPostArchived, range(100).map((i) => i > 2));

});


test.serial('archiveGranules archives granules more than 35 days old', async (t) => {
  const { knex } = t.context;
  const req = {
    body: {
      batchSize: 100,
      expirationDays: 35,
    },
    testContext: {
      knex,
      sfnMethod: () => ({
        getKnexClientMethod: () => knex,
      }),
    },
  };

  const res = {
    boom: {
      badRequest: sinon.stub(),
    },
    send: sinon.stub(),
  };
  const granuleModel = new GranulePgModel()

  await bulkArchive(req, res);
  const archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(async (fakeGranuleRecord) => (await granuleModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })).archived)
  );
  t.deepEqual(archivedPostArchived, range(100).map((i) => i > 35));

});

test.serial('archiveGranules archives only "batchSize" granules at a time', async (t) => {
  const { knex } = t.context;
  const req = {
    body: {
      batchSize: 10,
      expirationDays: 2,
    },
    testContext: {
      knex,
      sfnMethod: () => ({
        getKnexClientMethod: () => knex,
      }),
    },
  };

  const res = {
    boom: {
      badRequest: sinon.stub(),
    },
    send: sinon.stub(),
  };
  const granuleModel = new GranulePgModel()

  await bulkArchive(req, res);
  const archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(async (fakeGranuleRecord) => (await granuleModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })).archived)
  );
  t.is(10, archivedPostArchived.filter((archived) => archived).length);

});

test.serial('archiveGranules iterates "batchSize" granules at a time', async (t) => {
  const { knex } = t.context;
  const req = {
    body: {
      batchSize: 10,
      expirationDays: 2,
    },
    testContext: {
      knex,
      sfnMethod: () => ({
        getKnexClientMethod: () => knex,
      }),
    },
  };

  const res = {
    boom: {
      badRequest: sinon.stub(),
    },
    send: sinon.stub(),
  };
  const granuleModel = new GranulePgModel()

  await bulkArchive(req, res);
  let archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(async (fakeGranuleRecord) => (await granuleModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })).archived)
  );
  t.is(10, archivedPostArchived.filter((archived) => archived).length);
  await bulkArchive(req, res);
  archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(async (fakeGranuleRecord) => (await granuleModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })).archived)
  );
  // console.log(archivedPostArchived.filter((archived) => archived).length)
  t.is(20, archivedPostArchived.filter((archived) => archived).length);
  await bulkArchive(req, res);
  archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(async (fakeGranuleRecord) => (await granuleModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })).archived)
  );
  // console.log(archivedPostArchived.filter((archived) => archived).length)
  t.is(30, archivedPostArchived.filter((archived) => archived).length);
  await bulkArchive(req, res);
  archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(async (fakeGranuleRecord) => (await granuleModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })).archived)
  );
  // console.log(archivedPostArchived.filter((archived) => archived).length)
  t.is(40, archivedPostArchived.filter((archived) => archived).length);
  await bulkArchive(req, res);
  archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(async (fakeGranuleRecord) => (await granuleModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })).archived)
  );
  // console.log(archivedPostArchived.filter((archived) => archived).length)
  t.is(50, archivedPostArchived.filter((archived) => archived).length);


});