'use strict';

/**
 * Limited granules router for Iceberg API deployment.
 * Only exposes the list endpoint (GET /granules) and files lookup.
 */

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const { GranuleSearch } = require('@cumulus/db');
const { addOrcaRecoveryStatus } = require('../lib/orca');

const log = new Logger({ sender: '@cumulus/api/iceberg-limited-granules' });

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

  const dbSearch = new GranuleSearch({ queryStringParameters });
  const result = await dbSearch.query();

  if (getRecoveryStatus === 'true') {
    return res.send(await addOrcaRecoveryStatus(result));
  }
  return res.send(result);
}

// Only expose the list endpoint for Iceberg API
router.get('/', list);

module.exports = router;
