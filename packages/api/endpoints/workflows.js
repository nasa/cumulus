// @ts-check
'use strict';

const { z } = require('zod');
const isError = require('lodash/isError');
const Logger = require('@cumulus/logger');
const { getJsonS3Object, listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const {
  getWorkflowsListKeyPrefix,
  getWorkflowFileKey,
} = require('@cumulus/common/workflows');
const { getRequiredEnvVar } = require('@cumulus/common/env');
// @ts-ignore - express-promise-router types don't expose call signatures
const router = require('express-promise-router')();
const { zodParser } = require('../src/zod-utils');
const { returnCustomValidationErrors } = require('../lib/endpoints');
const log = new Logger({ sender: '@cumulus/api/workflows' });

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/**
 * @typedef {Object} Workflow
 * @property {string} name
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

  const systemBucket = getRequiredEnvVar('system_bucket');
  const stackName = getRequiredEnvVar('stackName');

  const workflows = await listS3ObjectsV2({
    Bucket: systemBucket,
    Prefix: getWorkflowsListKeyPrefix(stackName),
  }) ?? [];
  /** @type {Workflow[]} */
  let body = await Promise.all(workflows.map(
    (obj) => getJsonS3Object(systemBucket, /** @type {string} */ (obj.Key))
  ));

  // filter the body here
  if (prefix) {
    body = body.filter((workflow) => workflow.name.startsWith(prefix));
  }
  if (infix) {
    body = body.filter((workflow) => workflow.name.includes(infix));
  }

  if (fields) {
    // @ts-ignore - fields selection intentionally produces partial objects; sort uses String() to handle missing name
    body = body.map((workflow) =>
      Object.fromEntries(fields.map((field) => {
        if (!(field in workflow)) {
          log.warn(`Field "${field}" not found in workflow "${workflow.name}"`);
          return [field, null];
        }
        return [field, workflow[field]];
      })));
  }

  // we have to specify type json here because express
  // does not recognize an array as json automatically
  if (countOnly) {
    return res.type('json').send({ count: body.length });
  }
  body = body.sort((a, b) => {
    const nameA = String(a.name);
    const nameB = String(b.name);
    return order === 'desc'
      ? nameB.localeCompare(nameA)
      : nameA.localeCompare(nameB);
  });
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
    const systemBucket = getRequiredEnvVar('system_bucket');
    const stackName = getRequiredEnvVar('stackName');
    const workflow = await getJsonS3Object(
      systemBucket,
      getWorkflowFileKey(stackName, name)
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
