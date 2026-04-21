'use strict';

/**
 * Limited granules router for Iceberg API deployment.
 * Only exposes the list endpoint (GET /granules).
 */

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const { GranuleIcebergSearch } = require('@cumulus/db/duckdb');
const { addOrcaRecoveryStatus } = require('../lib/orca');

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

  let result;
  try {
    result = await new GranuleIcebergSearch({ queryStringParameters }).query();
  } catch (error) {
    log.error('GranuleIcebergSearch Query Failed', error);

    if (res.boom) {
      return res.boom.badImplementation('Error querying S3/Iceberg data');
    }

    return res.status(500).send({
      error: 'Internal Server Error',
      message: 'Error querying S3/Iceberg data',
    });
  }

  let finalResult = result;
  if (getRecoveryStatus === 'true') {
    finalResult = await addOrcaRecoveryStatus(result);
  }

  return res.send(finalResult);
}

// Only expose the list endpoint for Iceberg API
router.get('/', list);

module.exports = router;
