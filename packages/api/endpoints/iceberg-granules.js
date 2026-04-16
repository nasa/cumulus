'use strict';

/**
 * Limited granules router for Iceberg API deployment.
 * Only exposes the list endpoint (GET /granules).
 */

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const { addOrcaRecoveryStatus } = require('../lib/orca');
const {
  GranuleS3Search,
  acquireDuckDbConnection,
  releaseDuckDbConnection,
} = require('@cumulus/db/duckdb');

const log = new Logger({ sender: '@cumulus/api/iceberg-granules' });

/**
 * List and search granules
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  log.debug(`list query ${JSON.stringify(req.query)}`);
  const { getRecoveryStatus, ...queryStringParameters } = req.query;

  // Acquire connection from the shared singleton pool
  const conn = await acquireDuckDbConnection();

  try {
    const dbSearch = new GranuleS3Search({ queryStringParameters }, conn);
    const result = await dbSearch.query();

    let finalResult = result;
    if (getRecoveryStatus === 'true') {
      finalResult = await addOrcaRecoveryStatus(result);
    }

    return res.send(finalResult);
  } catch (error) {
    log.error('GranuleS3Search Query Failed', error);

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
    // Always release the connection back to the pool
    await releaseDuckDbConnection(conn);
  }
}

// Only expose the list endpoint for Iceberg API
router.get('/', list);

module.exports = router;
