'use strict';

const test = require('ava');
const models = require('../models');
const { randomString } = require('@cumulus/common/test-utils');

test('create, update and delete a kinesis type rule', async (t) => {
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

  const hash = { name: 'name', type: 'S' };
  const rules = new models.Rule();
  // create Rules table
  await models.Manager.createTable(process.env.RulesTable, hash);
  // create rule
  return rules.create(originalRule)
    .then(async(rule) => {
      t.is(rule.name, originalRule.name);
      t.is(rule.rule.value, originalRule.rule.value);
      t.false(rule.rule.arn === undefined);
      // update rule state
      const updated = { name: rule.name, state: 'ENABLED' };
      // deep copy rule
      const newRule = Object.assign({}, rule);
      newRule.rule = Object.assign({}, rule.rule);
      await rules.update(newRule, updated);
      return newRule;
    })
    .then(async(rule) => {
      t.true(rule.state === 'ENABLED');
      t.is(rule.rule.arn, originalRule.rule.arn);
      // update rule value, result in new arn
      const updated = { name: rule.name,
        rule: { type: rule.rule.type, value: 'my-new-kinesis-arn' } };
      const newRule = Object.assign({}, rule);
      newRule.rule = Object.assign({}, rule.rule);
      await rules.update(newRule, updated);
      return newRule;
    })
    .then(async(rule) => {
      t.is(rule.name, originalRule.name);
      t.not(rule.rule.vale, originalRule.rule.value);
      t.not(rule.rule.arn, originalRule.rule.arn);
      // retrieve rule
      return await rules.get({ name: rule.name });
    })
    .then(async(rule) => {
      // delete rule
      await rules.delete(rule);
    })
    .finally(() => {
      // cleanup table
      models.Manager.deleteTable(process.env.RulesTable);
    });
});
