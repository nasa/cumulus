'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const {
  localStackConnectionEnv,
  getKnexClient,
  tableNames,
  doesRecordExist,
} = require('@cumulus/db');

const {
  writeRules,
} = require('../../../lambdas/sf-event-sqs-to-db-records/write-rules');

const { migrationDir } = require('../../../../../lambdas/db-migration');

const { fakeFileFactory, fakeRuleFactoryV2 } = require('../../../lib/testUtils');
const Rule = require('../../../models/rules');

test.before(async (t) => {
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  const ruleModel = new Rule();
  await ruleModel.createTable();
  t.context.ruleModel = ruleModel;

  t.context.testDbName = `writeRules_${cryptoRandomString({ length: 10 })}`;

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
  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${t.context.executionName}`;

  t.context.collection = {
    name: cryptoRandomString({ length: 5 }),
    version: '0.0.0',
    sample_file_name: 'file.txt',
    rule_id_extraction_regex: 'fake-regex',
    rule_id_validation_regex: 'fake-regex',
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

  t.context.ruleName = cryptoRandomString({ length: 10 });
  const files = [fakeFileFactory()];
  const rule = fakeRuleFactoryV2({ files, ruleName: t.context.ruleName });

  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      state_machine: t.context.stateMachineArn,
      execution_name: t.context.executionName,
    },
    meta: {
      status: 'running',
      collection: t.context.collection,
      provider: t.context.provider,
    },
    payload: {
      rules: [rule],
    },
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

test('writeRules() throws an error if collection is not provided', async (t) => {
  const { cumulusMessage, knex, providerCumulusId } = t.context;
  await t.throwsAsync(
    writeRules({
      cumulusMessage,
      collectionCumulusId: undefined,
      providerCumulusId,
      knex,
    })
  );
});

test('writeRules() saves rule records to Dynamo and RDS if RDS write is enabled', async (t) => {
  const {
    cumulusMessage,
    ruleModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    ruleName,
  } = t.context;

  await writeRules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  });

  t.true(await ruleModel.exists({ ruleName }));
  t.true(
    await doesRecordExist({ rule_id: ruleName }, knex, tableNames.rules)
  );
});

test('writeRules() handles successful and failing writes independently', async (t) => {
  const {
    cumulusMessage,
    ruleModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    ruleName,
  } = t.context;

  const rule2 = {
    // no rule ID should cause failure
  };
  cumulusMessage.payload.rules = [
    ...cumulusMessage.payload.rules,
    rule2,
  ];

  await t.throwsAsync(writeRules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  }));

  t.true(await ruleModel.exists({ ruleName }));
  t.true(
    await doesRecordExist({ rule_id: ruleName }, knex, tableNames.rules)
  );
});

test('writeRules() throws error if any rule writes fail', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  cumulusMessage.payload.rules = [
    ...cumulusMessage.payload.rules,
    // this object is not a valid rule, so its write should fail
    {},
  ];

  await t.throwsAsync(writeRules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  }));
});

test.serial('writeRules() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    ruleModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    ruleName,
  } = t.context;

  const fakeRuleModel = {
    storeRuleFromCumulusMessage: () => {
      throw new Error('Rules dynamo error');
    },
  };

  const [error] = await t.throwsAsync(
    writeRules({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
      ruleModel: fakeRuleModel,
    })
  );

  t.true(error.message.includes('Rules dynamo error'));
  t.false(await ruleModel.exists({ ruleName }));
  t.false(
    await doesRecordExist({ rule_id: ruleName }, knex, tableNames.rules)
  );
});

test.serial('writeRules() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    ruleModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    ruleName,
  } = t.context;

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('Rules RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  const [error] = await t.throwsAsync(writeRules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  }));

  t.true(error.message.includes('Rules RDS error'));
  t.false(await ruleModel.exists({ ruleName }));
  t.false(
    await doesRecordExist({ rule_id: ruleName }, knex, tableNames.rules)
  );
});
