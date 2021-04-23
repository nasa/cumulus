'use strict';

const router = require('express-promise-router')();
const { Search } = require('../es/search');

const metrics = () => ('log_destination_arn' in process.env);

const esMetricsParams = ['_doc', `${process.env.stackName}-*`, true];

/**
 * list all the logs
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  if (!metrics()) {
    return res.boom.badRequest('Metrics not configured');
  }

  const search = new Search(
    { queryStringParameters: req.query },
    ...esMetricsParams
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
  if (!metrics()) {
    return res.boom.badRequest('Metrics not configured');
  }

  const executionName = req.params.executionName;

  const search = new Search(
    {
      queryStringParameters: {
        limit: 50,
        'executions.keyword': executionName,
      },
    },
    ...esMetricsParams
  );
  const result = await search.query();
  return res.send(result);
}

router.get('/:executionName', get);
router.get('/', list);

module.exports = router;
