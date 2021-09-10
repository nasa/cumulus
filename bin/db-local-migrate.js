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

  await db.migrate.latest();
})();
