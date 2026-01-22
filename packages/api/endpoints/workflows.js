'use strict';

const { z } = require('zod');
const isError = require('lodash/isError');
const { getJsonS3Object, listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const {
  getWorkflowsListKeyPrefix,
  getWorkflowFileKey,
} = require('@cumulus/common/workflows');
const router = require('express-promise-router')();
const { zodParser } = require('../src/zod-utils');
const { returnCustomValidationErrors } = require('../lib/endpoints');

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

const ListWorkflowsSchema = z.object({
  prefix: z.string().optional(),
  infix: z.string().optional(),
  limit: z.coerce.number().positive().optional(),
  order: z.enum(['asc', 'desc']).optional(),
  fields: z.string().optional(),
  countOnly: z.enum(['true', 'false']).optional(),
}).catchall(z.unknown());

const listWorkflowsPayloadParser = zodParser('ListWorkflows payload', ListWorkflowsSchema);

/**
 * List workflows.
 *
 * @param {Request} req - express request object
 * @param {Response} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const query = listWorkflowsPayloadParser(req.query);

  if (isError(query)) {
    return returnCustomValidationErrors(res, query);
  }

  const {
    prefix,
    infix,
    order,
    limit,
  } = query;
  const countOnly = query.countOnly === 'true';
  const fields = query.fields?.split(',');

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
  }
  if (infix) {
    body = body.filter((workflow) => workflow.name.includes(infix));
  }

  if (fields) {
    body = body.map((workflow) =>
      Object.fromEntries(fields.map((field) => [field, workflow[field]])));
  }

  // we have to specify type json here because express
  // does not recognize an array as json automatically
  if (countOnly) {
    return res.type('json').send({ count: body.length });
  }
  body = order === 'desc' ? body.sort((a, b) => b.name.localeCompare(a.name))
    : body.sort((a, b) => a.name.localeCompare(b.name));
  body = limit ? body.slice(0, limit) : body;
  return res.type('json').send(body);
}

/**
 * Query a single workflow.
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
