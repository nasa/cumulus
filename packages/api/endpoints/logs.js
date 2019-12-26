'use strict';

const router = require('express-promise-router')();
const log = require('@cumulus/common/log');
const { Search } = require('../es/search');

function convertLogLevelForQuery(query) {
  if (!query.level) {
    return query;
  }

  return Object.assign({}, query, { level: log.convertLogLevel(query.level) });
}

/**
 * list all the logs
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const search = new Search(
    { queryStringParameters: convertLogLevelForQuery(req.query) },
    'logs',
    process.env.ES_INDEX
  );

  const result = await search.query();
  return res.send(result);
}

/**
 * Query logs from a single workflow execution.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const executionName = req.params.executionName;

  const search = new Search(
    {
      queryStringParameters: {
        limit: 50,
        'executions.keyword': executionName
      }
    },
    'logs',
    process.env.ES_INDEX
  );
  const result = await search.query();
  return res.send(result);
}

router.get('/:executionName', get);
router.get('/', list);

module.exports = router;
