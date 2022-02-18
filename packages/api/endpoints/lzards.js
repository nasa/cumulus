'use strict';

const router = require('express-promise-router')();
const Logger = require('@cumulus/logger');
const url = require('url');
const logger = new Logger({ sender: '@cumulus/api/lzards' });
const {
  getRequestToLzards,
} = require('../lib/lzards');

/**
 * Get request to LZARDS
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const queryString = url.parse(req.originalUrl).search;

  const { statusCode, body } = await getRequestToLzards({
    queryParams: queryString,
  });

  if (statusCode === 200) return res.send(body);

  logger.error(`${req.path} Request failed - LZARDS api returned ${statusCode}: ${JSON.stringify(body)}`);
  if (statusCode === 404) return res.boom.notFound(JSON.stringify(body));
  return res.boom.badRequest(JSON.stringify(body));
}

router.get('*/', get);

module.exports = router;
