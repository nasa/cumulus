'use strict';

const mapKeys = require('lodash/mapKeys');
const router = require('express-promise-router')();

const { lambda } = require('@cumulus/aws-client/services');
const Logger = require('@cumulus/logger');
const logger = new Logger({ sender: '@cumulus/api/orca' });

const mapKeysToOrca = {
  granuleId: 'granule_id',
};

/**
 * List recovery request status
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function listRequests(req, res) {
  const query = req.query || {};
  const { granuleId, asyncOperationId, ...rest } = query;
  if (Object.keys(rest).length !== 0 || !(granuleId || asyncOperationId)) {
    const errorMsg = 'Please specify granuleId and/or asyncOperationId';
    logger.error(errorMsg);
    return res.boom.badRequest(errorMsg);
  }

  const params = mapKeys(query, (value, key) => mapKeysToOrca[key] || key);
  const inputPayload = { function: 'query', ...params };
  const functionName = `${process.env.stackName}_request_status`;

  const result = await lambda().invoke({
    FunctionName: functionName,
    Payload: JSON.stringify(inputPayload),
    InvocationType: 'RequestResponse',
  }).promise();

  return res.send(JSON.parse(result.Payload));
}

router.get('/recovery', listRequests);

module.exports = router;
