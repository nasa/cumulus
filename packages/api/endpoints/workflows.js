'use strict';

const aws = require('@cumulus/common/aws');
const router = require('express-promise-router')();

/**
 * Get S3 object
 *
 * @returns {Object} object fetched from S3 bucket
 */
async function getWorkflowList() {
  const workflowsListKey = `${process.env.stackName}/workflows/list.json`;
  try {
    const { Body } = await aws.getS3Object(process.env.system_bucket, workflowsListKey);
    return Body.toString();
  }
  catch (err) {
    throw err;
  }
}

/**
 * List all providers.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const body = await getWorkflowList();

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
    const body = await getWorkflowList();

    const workflows = JSON.parse(body);

    const matchingWorkflow = workflows.find((workflow) => workflow.name === name);
    if (matchingWorkflow) return res.send(matchingWorkflow);

    return res.boom.notFound('The specified workflow does not exist.');
  }
  catch (err) {
    if (err.name === 'NoSuchKey') {
      return res.boom.notFound('Workflow does not exist!');
    }
    throw err;
  }
}

router.get('/:name', get);
router.get('/', list);

module.exports = router;
