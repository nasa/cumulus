'use strict';

const { handler } = require('../lambdas/db-migration/dist/lambda');

handler({
  env: {
    KNEX_ASYNC_STACK_TRACES: 'true',
    KNEX_DEBUG: 'true',
    PG_HOST: 'localhost',
    PG_USER: 'postgres',
    PG_PASSWORD: 'password',
    PG_DATABASE: 'postgres',
  },
}).catch(console.error);
