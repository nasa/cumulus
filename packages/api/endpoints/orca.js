'use strict';

const router = require('express-promise-router')();

const Logger = require('@cumulus/logger');
const logger = new Logger({ sender: '@cumulus/api/orca' });
const { postRequestToOrca } = require('../lib/orca');

/**
 * post request to ORCA
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const { statusCode, body } = await postRequestToOrca({
    path: req.path,
    body: req.body || {},
  });

  if (statusCode === 200) return res.send(body);

  logger.error(`${req.path} Request failed - ORCA api returned ${statusCode}: ${JSON.stringify(body)}`);
  if (statusCode === 404) return res.boom.notFound(JSON.stringify(body));
  return res.boom.badRequest(JSON.stringify(body));
}

router.post('/*', post);

module.exports = router;
