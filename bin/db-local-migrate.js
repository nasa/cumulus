'use strict';

const { migrationDir } = require('../lambdas/db-migration');
const { getKnexClient, localStackConnectionEnv } = require('../packages/db');

(async () => {
  const db = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      migrationDir,
    },
  });

  await db.migrate.latest();
})();
