'use strict';

/**
 * Limited executions router for Iceberg API deployment.
 * Only exposes the list endpoint (GET /executions).
 */

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const {
  ExecutionS3Search,
  acquireDuckDbConnection,
  releaseDuckDbConnection,
} = require('@cumulus/db/duckdb');

const log = new Logger({ sender: '@cumulus/api/iceberg-executions' });

/**
 * List and search executions
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  log.debug(`list query ${JSON.stringify(req.query)}`);
  const conn = await acquireDuckDbConnection();

  try {
    const search = new ExecutionS3Search({ queryStringParameters: req.query }, conn);
    const response = await search.query();
    return res.send(response);
  } catch (error) {
    log.error('ExecutionS3Search Query Failed', error);
    if (res.boom) {
      return res.boom.badImplementation('Error querying S3/Iceberg data', {
        details: error.message,
      });
    }
    return res.status(500).send({
      error: 'Internal Server Error',
      message: 'Error querying S3/Iceberg data',
      details: error.message,
    });
  } finally {
    await releaseDuckDbConnection(conn);
  }
}

// Only expose the list endpoint for Iceberg API
router.get('/', list);

module.exports = router;
