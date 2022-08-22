'use strict';

const {
  getKnexClient,
  localStackConnectionEnv,
  migrationDir,
} = require('../packages/db');

(async () => {
  const db = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      migrationDir,
      KNEX_ASYNC_STACK_TRACES: 'true',
      KNEX_DEBUG: 'true'
    },
  });

  await db.migrate.latest();
})();
