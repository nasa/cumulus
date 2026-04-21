'use strict';

/**
 * Limited executions router for Iceberg API deployment.
 * Only exposes the list endpoint (GET /executions).
 */

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const { ExecutionIcebergSearch } = require('@cumulus/db/duckdb');

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

  try {
    const response = await new ExecutionIcebergSearch({ queryStringParameters: req.query }).query();
    return res.send(response);
  } catch (error) {
    log.error('ExecutionIcebergSearch Query Failed', error);
    if (res.boom) {
      return res.boom.badImplementation('Error querying S3/Iceberg data');
    }
    return res.status(500).send({
      error: 'Internal Server Error',
      message: 'Error querying S3/Iceberg data',
    });
  }
}

// Only expose the list endpoint for Iceberg API
router.get('/', list);

module.exports = router;
