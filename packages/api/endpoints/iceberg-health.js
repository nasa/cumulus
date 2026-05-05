'use strict';

const router = require('express-promise-router')();
const { isDuckDbReady } = require('@cumulus/db/duckdb');

/**
 * Health check endpoint for Iceberg API
 * Verifies that DuckDB is initialized without acquiring a connection,
 * to avoid pool contention from frequent health checks.
 *
 * @param {import('express').Request} req - express request object
 * @param {import('express').Response} res - express response object
 * @returns {import('express').Response}
 */
function get(req, res) {
  if (isDuckDbReady()) {
    return res.status(200).send('Ready');
  }
  return res.status(503).send('Initializing');
}

router.get('/', get);

module.exports = router;
