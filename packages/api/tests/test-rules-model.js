'use strict';

const test = require('ava');
const models = require('../models');
const { randomString } = require('@cumulus/common/test-utils');

process.env.RulesTable = `RulesTable_${randomString()}`;
process.env.stackName = 'my-stackName';
process.env.kinesisConsumer = 'my-kinesisConsumer';

const originalRule = {
  name: 'my_kinesis_rule',
  workflow: 'my-workflow',
  provider: 'my provider',
  collection: {
    name: 'my-collection-name',
    version: 'my-collection-version'
  },
  rule: {
    type: 'kinesis',
    value: 'my-kinesis-arn'
  },
  state: 'DISABLED'
};

test.before(async () => {
  const hash = { name: 'name', type: 'S' };
  // create Rules table
  await models.Manager.createTable(process.env.RulesTable, hash);
});

test.after.always(async () => {
  // cleanup table
  models.Manager.deleteTable(process.env.RulesTable);
});

test('create and delete a kinesis type rule', async (t) => {
  // create rule
  const rules = new models.Rule();
  return rules.create(originalRule)
    .then(async (rule) => {
      t.is(rule.name, originalRule.name);
      t.is(rule.rule.value, originalRule.rule.value);
      t.false(rule.rule.arn === undefined);
      // delete rule
      await rules.delete(rule);
    });
});

test('update a kinesis type rule state, arn does not change', async (t) => {
  // create rule
  const rules = new models.Rule();
  await rules.create(originalRule);
  const rule = await rules.get({ name: originalRule.name });

  // update rule state
  const updated = { name: rule.name, state: 'ENABLED' };
  // deep copy rule
  const newRule = Object.assign({}, rule);
  newRule.rule = Object.assign({}, rule.rule);
  await rules.update(newRule, updated);

  t.true(newRule.state === 'ENABLED');
  //arn doesn't change
  t.is(newRule.rule.arn, rule.rule.arn);
});

test('update a kinesis type rule value, resulting in new arn', async (t) => {
  // create rule
  const rules = new models.Rule();
  await rules.create(originalRule);
  const rule = await rules.get({ name: originalRule.name });

  // update rule value
  const updated = {
    name: rule.name,
    rule: { type: rule.rule.type, value: 'my-new-kinesis-arn' }
  };
  // deep copy rule
  const newRule = Object.assign({}, rule);
  newRule.rule = Object.assign({}, rule.rule);
  await rules.update(newRule, updated);

  t.is(newRule.name, rule.name);
  t.not(newRule.rule.vale, rule.rule.value);
  t.not(newRule.rule.arn, rule.rule.arn);
});
