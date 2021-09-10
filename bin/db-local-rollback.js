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
    },
  });

  await db.migrate.rollback(undefined, process.argv[2] === '--all');
})();
