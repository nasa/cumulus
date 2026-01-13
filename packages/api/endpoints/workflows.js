'use strict';

const { getJsonS3Object, listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const {
  getWorkflowsListKeyPrefix,
  getWorkflowFileKey,
} = require('@cumulus/common/workflows');
const router = require('express-promise-router')();

/**
 * List all providers.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  // countonly -> handled
  // limit -> handled
  // order -> really only works with name alphabetically
  // fields -> handled

  // prefix -> handled
  // infix -> handled

  const countOnly = req.params.countOnly || false;
  const prefix = req.params.prefix;
  const infix = req.params.infix;
  const arn = req.params.arn;
  const name = req.params.name;
  const template = req.params.template;
  const limit = req.params.limit;
  const orderBy = req.params.order;

  const workflows = await listS3ObjectsV2({
    Bucket: process.env.system_bucket,
    Prefix: getWorkflowsListKeyPrefix(process.env.stackName),
  });
  let body = await Promise.all(workflows.map(
    (obj) => getJsonS3Object(process.env.system_bucket, obj.Key)
  ));

  // filter the body here
  if (prefix) {
    body = body.filter((workflow) => workflow.name.startsWith(prefix));
  } else if (infix) {
    body = body.filter((workflow) => workflow.name.includes(infix));
  }

  const fields = { arn, name, template };

  Object.entries(fields).forEach(([field, value]) => {
    if (value !== undefined) {
      body = body.filter((workflow) => workflow[field] === value);
    }
  });

  // we have to specify type json here because express
  // does not recognize an array as json automatically
  if (countOnly) {
    return res.type('json').send({ count: body.length });
  }
  body = orderBy === 'desc' ? body.sort((a, b) => b.name.localeCompare(a.name))
    : body.sort((a, b) => a.name.localeCompare(b.name));
  body = limit ? body.slice(0, limit) : body;
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
    const workflow = await getJsonS3Object(
      process.env.system_bucket,
      getWorkflowFileKey(process.env.stackName, name)
    );
    return res.send(workflow);
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.name === 'NoSuchBucket') {
      return res.boom.notFound('Workflow does not exist!');
    }
    throw error;
  }
}

router.get('/:name', get);
router.get('/', list);

module.exports = router;
