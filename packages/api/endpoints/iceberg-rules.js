'use strict';

/**
 * Limited rules router for Iceberg API deployment.
 * Only exposes the list endpoint (GET /rules).
 */

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const {
  RuleS3Search,
  acquireDuckDbConnection,
  releaseDuckDbConnection,
} = require('@cumulus/db/duckdb');

const log = new Logger({ sender: '@cumulus/api/iceberg-rules' });

/**
 * List and search rules
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  log.debug(`list query ${JSON.stringify(req.query)}`);
  const conn = await acquireDuckDbConnection();

  try {
    const search = new RuleS3Search({ queryStringParameters: req.query }, conn);
    const response = await search.query();
    return res.send(response);
  } catch (error) {
    log.error('RuleS3Search Query Failed', error);
    if (res.boom) {
      return res.boom.badImplementation('Error querying S3/Iceberg data');
    }
    return res.status(500).send({
      error: 'Internal Server Error',
      message: 'Error querying S3/Iceberg data',
    });
  } finally {
    await releaseDuckDbConnection(conn);
  }
}

// Only expose the list endpoint for Iceberg API
router.get('/', list);

module.exports = router;
