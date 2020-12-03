'use strict';

const test = require('ava');
const {
  writeRules,
} = require('../../../lambdas/sf-event-sqs-to-db-records/write-rules');

const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');
const Rule = require('../../../models/rules');

test('writeRules() saves rule records to Dynamo and RDS if RDS write is enabled', async (t) => {
});

test('writeRules() handles successful and failing writes independently', async (t) => {
});

test('writeRules() throws error if any rule writes fail', async (t) => {
});

test.serial('writeRules() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
});

test.serial('writeRules() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {

});
