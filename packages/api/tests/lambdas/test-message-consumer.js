'use strict';

const test = require('ava');

const { randomId } = require('@cumulus/common/test-utils');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  //RulePgModel,
} = require('@cumulus/db');

//const messageConsumer = require('../../lambdas/message-consumer');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = randomId();

test.before(async (t) => {
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.todo('processRecord processes records');
