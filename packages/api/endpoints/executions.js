'use strict';

const router = require('express-promise-router')();
const Search = require('../es/search').Search;
const models = require('../models');

/**
 * List and search executions
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object 
 */
async function list(req, res) {
  const search = new Search({
    queryStringParameters: req.query
  }, 'execution');
  const response = await search.query();
  return res.send(response);
}

/**
 * get a single execution
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object 
 */
async function get(req, res) {
  const arn = req.params.arn;

  const e = new models.Execution();

  const response = await e.get({ arn });
  return res.send(response)
}

router.get('/:arn', get);
router.get('/', list);

module.exports = router;
