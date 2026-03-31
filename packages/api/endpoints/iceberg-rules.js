'use strict';

/**
 * Limited rules router for Iceberg API deployment.
 * Only exposes the list endpoint (GET /rules).
 */

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const { RuleSearch } = require('@cumulus/db');

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
  const search = new RuleSearch({ queryStringParameters: req.query });
  const response = await search.query();
  return res.send(response);
}

// Only expose the list endpoint for Iceberg API
router.get('/', list);

module.exports = router;