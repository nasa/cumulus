'use strict';

/**
 * Limited collections router for Iceberg API deployment.
 * Only exposes the list endpoint (GET /collections).
 */

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const { CollectionSearch } = require('@cumulus/db');

const log = new Logger({ sender: '@cumulus/api/iceberg-collections' });

/**
 * List and search collections
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  log.debug(`list query ${JSON.stringify(req.query)}`);
  const search = new CollectionSearch({ queryStringParameters: req.query });
  const response = await search.query();
  return res.send(response);
}

// Only expose the list endpoint for Iceberg API
router.get('/', list);

module.exports = router;
