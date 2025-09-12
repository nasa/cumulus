'use strict';

const sinon = require('sinon');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
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
const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { bulkPatchGranuleArchived } = require('../../endpoints/granules');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let granulePgModel;

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

test.before((t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
  };

  granulePgModel = new GranulePgModel();
  t.context.granulePgModel = granulePgModel;
});

test.beforeEach(async (t) => {
  // These must be run serially to keep DBs separated by env var
  process.env.PG_DATABASE = testDbName;
  // Generate a local test postGres database
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
  t.context.fakePGGranules = range(10).map(() => fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
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
});

test.serial('bulkPatchGranuledArchived archives and un-archives a set of granules', async (t) => {
  const { knex } = t.context;
  const granuleModel = new GranulePgModel();
  const granulesPreProcess = await Promise.all(t.context.insertedPgGranules.map((granule) => (
    granuleModel.get(knex, { cumulus_id: granule.cumulus_id })
  )));
  const res = {
    boom: {
      badRequest: sinon.stub(),
    },
    send: sinon.stub(),
  };
  await bulkPatchGranuleArchived(
    {
      body: {
        granuleIds: granulesPreProcess.map((granule) => granule.granule_id),
        archived: true,
      },
      testContext: {
        knex,
        sfnMethod: () => ({
          getKnexClientMethod: () => knex,
        }),
      },
    },
    res
  );
  const granulesPostProcess = await Promise.all(t.context.insertedPgGranules.map((granule) => (
    granuleModel.get(knex, { cumulus_id: granule.cumulus_id })
  )));
  granulesPostProcess.forEach((granule) => {
    t.true(granule.archived);
  });
  await bulkPatchGranuleArchived(
    {
      body: {
        granuleIds: granulesPreProcess.map((granule) => granule.granule_id),
        archived: false,
      },
      testContext: {
        knex,
        sfnMethod: () => ({
          getKnexClientMethod: () => knex,
        }),
      },
    },
    res
  );
  const finalGranules = await Promise.all(t.context.insertedPgGranules.map((granule) => (
    granuleModel.get(knex, { cumulus_id: granule.cumulus_id })
  )));
  finalGranules.forEach((granule) => {
    t.false(granule.archived);
  });
});
