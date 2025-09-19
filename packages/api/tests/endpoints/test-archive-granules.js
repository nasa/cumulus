'use strict';

const sinon = require('sinon');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const moment = require('moment');
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

const { bulkArchiveGranules } = require('../../endpoints/granules');

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
  t.context.fakePGGranules = range(100).map((i) => fakeGranuleRecordFactory({
    updated_at: moment().subtract(i, 'd'),
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

test.serial('bulkArchiveGranules archives granules more than 2 days old', async (t) => {
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

  await bulkArchiveGranules(req, res);
  const archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(
      async (fakeGranuleRecord) => (
        (await t.context.granulePgModel.get(knex, {
          cumulus_id: fakeGranuleRecord[0].cumulus_id,
        })).archived
      )
    )
  );
  t.deepEqual(archivedPostArchived, range(100).map((i) => i > 2));
});

test.serial('bulkArchiveGranules archives granules more than 35 days old', async (t) => {
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

  await bulkArchiveGranules(req, res);
  const archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(
      async (fakeGranuleRecord) => (
        await t.context.granulePgModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })
      ).archived
    )
  );
  t.deepEqual(archivedPostArchived, range(100).map((i) => i > 35));
});

test.serial('bulkArchiveGranules archives only "batchSize" granules at a time', async (t) => {
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

  await bulkArchiveGranules(req, res);
  const archivedPostArchived = await Promise.all(
    t.context.fakePGGranuleRecords.map(
      async (fakeGranuleRecord) => (
        await t.context.granulePgModel.get(knex, { cumulus_id: fakeGranuleRecord[0].cumulus_id })
      ).archived
    )
  );
  t.is(10, archivedPostArchived.filter((archived) => archived).length);
});

test.serial('bulkArchiveGranules iterates "batchSize" granules at a time', async (t) => {
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
  for (const i of range(5)) {
    // eslint-disable-next-line no-await-in-loop
    await bulkArchiveGranules(req, res);
    const archivedPostArchived = await Promise.all(
      t.context.fakePGGranuleRecords.map(
        async (fakeGranuleRecord) => (
          await t.context.GranulePgModel.get(
            knex,
            { cumulus_id: fakeGranuleRecord[0].cumulus_id }
          )
        ).archived
      )
    );
    // js really wants to interpret i as a string here, which gets you things like 1+1 = 11
    t.is((10 * (Number(i) + 1)), archivedPostArchived.filter((archived) => archived).length);
  }
});
