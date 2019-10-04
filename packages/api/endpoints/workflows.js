'use strict';

const { getWorkflowList, getWorkflowFile } = require('@cumulus/common/workflows');
const router = require('express-promise-router')();

/**
 * List all providers.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const body = await getWorkflowList(process.env.stackName, process.env.system_bucket);
  // we have to specify type json here because express
  // does not recognize an array as json automatically
  return res.type('json').send(body);
}

/**
 * Query a single provider.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const name = req.params.name;
  try {
    const workflow = await getWorkflowFile(process.env.stackName, process.env.system_bucket, name);
    return res.send(workflow);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.name === 'NoSuchBucket') {
      return res.boom.notFound('Workflow does not exist!');
    }
    throw err;
  }
}

router.get('/:name', get);
router.get('/', list);

module.exports = router;
