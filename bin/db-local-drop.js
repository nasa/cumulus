/* eslint-disable node/no-unpublished-require */

'use strict';

const Knex = require('knex');
const { dropAllTables } = require('../packages/db');

(async () => {
  const knex = Knex({
    client: 'pg',
    connection: {
      host: 'localhost',
      user: 'postgres',
      password: 'password',
      database: 'postgres',
    },
    asyncStackTraces: true,
  });

  try {
    return await dropAllTables({ knex });
  } finally {
    await knex.destroy();
  }
})().catch(console.error);
