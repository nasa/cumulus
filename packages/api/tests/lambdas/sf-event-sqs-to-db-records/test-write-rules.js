'use strict';

const cryptoRandomString = require('crypto-random-string');
const test = require('ava');

const {
  localStackConnectionEnv,
  getKnexClient,
  tableNames,
  doesRecordExist,
} = require('@cumulus/db');
const { randomString } = require('@cumulus/common/test-utils');

const {
  writeRules,
} = require('../../../lambdas/sf-event-sqs-to-db-records/write-rules');

const { migrationDir } = require('../../../../../lambdas/db-migration');
const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');
const Rule = require('../../../models/rules');

test.before(async (t) => {
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  const ruleModel = new Rule();
  await ruleModel.createTable();
  t.context.ruleModel = ruleModel;

  t.context.testDbName = `writeRules${cryptoRandomString({ length: 10 })}`;

  t.context.knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  await t.context.knexAdmin.raw(`create database "${t.context.testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${t.context.testDbName}" to "${localStackConnectionEnv.PG_USER}"`);
  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: t.context.testDbName,
      migrationDir,
    },
  });
  await t.context.knex.migrate.latest();
});

test.beforeEach(async (t) => {
  t.context.onetimeRule = {
    name: cryptoRandomString({ length: 10 }),
    workflow: randomString(),
    provider: randomString(),
    collection: {
      name: randomString(),
      version: 'my-collection-version',
    },
    rule: {
      type: 'onetime',
    },
    state: 'ENABLED',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  t.context.kinesisRule = {
    name: cryptoRandomString({ length: 5 }),
    workflow: randomString(),
    provider: cryptoRandomString({ length: 10 }),
    collection: {
      name: cryptoRandomString({ length: 10 }),
      version: '0.0.0',
    },
    rule: {
      type: 'kinesis',
      value: randomString(),
    },
    state: 'ENABLED',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  t.context.cumulusMessage = {
    cumulus_meta: {
      execution_name: cryptoRandomString({ length: 5 }),
      state_machine: cryptoRandomString({ length: 5 }),
      workflow_start_time: Date.now(),
    },
    meta: {
      collection: {
        name: 'name',
        version: '001',
      },
      provider: {
        host: 'example-bucket',
        protocol: 's3',
        id: 'id',
      },
      status: 'completed',
      workflow: randomString(),
    },
    payload: {
      rules: [
        t.context.onetimeRule,
        t.context.kinesisRule,
      ],
    },
  };

  t.context.collection = {
    name: cryptoRandomString({ length: 5 }),
    version: '0.0.0',
    sample_file_name: 'file.txt',
    granule_id_extraction_regex: 'fake-regex',
    granule_id_validation_regex: 'fake-regex',
    files: JSON.stringify([{
      regex: 'fake-regex',
      sampleFileName: 'file.txt',
    }]),
  };

  t.context.provider = {
    id: `provider${cryptoRandomString({ length: 5 })}`,
    host: 'test-bucket',
    protocol: 's3',
  };
  const collectionResponse = await t.context.knex(tableNames.collections)
    .insert(t.context.collection)
    .returning('cumulus_id');

  t.context.collectionCumulusId = collectionResponse[0];

  const providerResponse = await t.context.knex(tableNames.providers)
    .insert({
      name: t.context.provider.id,
      host: t.context.provider.host,
      protocol: t.context.provider.protocol,
    })
    .returning('cumulus_id');
  t.context.providerCumulusId = providerResponse[0];
});

test.after.always(async (t) => {
  const {
    ruleModel,
  } = t.context;
  await ruleModel.deleteTable();
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${t.context.testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('writeRules() saves rule records to Dynamo and RDS', async (t) => {
  const {
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
    onetimeRule,
    kinesisRule,
    ruleModel,
  } = t.context;

  await writeRules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  });

  t.true(await ruleModel.exists({ name: onetimeRule.name }));
  t.true(await ruleModel.exists({ name: kinesisRule.name }));
  t.true(
    await doesRecordExist({ name: onetimeRule.name }, knex, tableNames.rules)
  );
});

/*
test('writeRules() handles successful and failing writes independently', async (t) => {
});

test('writeRules() throws error if any rule writes fail', async (t) => {
});

test.serial('writeRules() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
});

test.serial('writeRules() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {
});
*/
