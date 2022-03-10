const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  RulePgModel,
  fakeRuleRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
} = require('../../dist');

const testDbName = `rule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.rulePgModel = new RulePgModel();
});

test.beforeEach((t) => {
  t.context.ruleRecord = fakeRuleRecordFactory();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('RulePgModel.upsert() creates new rule', async (t) => {
  const {
    knex,
    rulePgModel,
    ruleRecord,
  } = t.context;

  await rulePgModel.upsert(knex, ruleRecord);

  t.like(
    await rulePgModel.get(knex, ruleRecord),
    ruleRecord
  );
});

test('RulePgModel.upsert() overwrites a rule record', async (t) => {
  const {
    knex,
    rulePgModel,
    ruleRecord,
  } = t.context;

  await rulePgModel.create(knex, ruleRecord);

  const updatedRule = {
    ...ruleRecord,
    value: cryptoRandomString({ length: 5 }),
  };

  await rulePgModel.upsert(knex, updatedRule);

  t.like(
    await rulePgModel.get(knex, {
      name: ruleRecord.name,
    }),
    updatedRule
  );
});

test('RulePgModel.upsert() returns an array of an object with all fields of a record by default', async (t) => {
  const {
    knex,
    rulePgModel,
    ruleRecord,
  } = t.context;

  const [upsertedRecord] = await rulePgModel.upsert(knex, ruleRecord);

  t.deepEqual(
    await rulePgModel.get(knex, ruleRecord),
    upsertedRecord
  );
});
