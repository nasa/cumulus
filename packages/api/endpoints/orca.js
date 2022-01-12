'use strict';

const got = require('got');
const mapKeys = require('lodash/mapKeys');
const router = require('express-promise-router')();

const { lambda } = require('@cumulus/aws-client/services');
const Logger = require('@cumulus/logger');
const { errorify } = require('../lib/utils');
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
  const functionName = granuleId
    ? `${process.env.stackName}_request_status_for_granule`
    : `${process.env.stackName}_request_status_for_job`;

  try {
    const result = await lambda().invoke({
      FunctionName: functionName,
      Payload: JSON.stringify(params),
      InvocationType: 'RequestResponse',
    }).promise();

    return res.send(JSON.parse(result.Payload));
  } catch (error) {
    if (error.code === 'ResourceNotFoundException' && error.message.includes(functionName)) {
      const errMsg = `${error.message}, please check if orca is deployed`;
      logger.error(errMsg, error);
      return res.boom.badRequest(errMsg);
    }
    throw error;
  }
}

async function postToOrca(req, res) {
  const orcaApiUri = process.env.orca_api_uri;
  if (!orcaApiUri) {
    const errMsg = 'The orca_api_uri environment variable is not set';
    logger.error(errMsg);
    return res.boom.badRequest(errMsg);
  }

  const requestBody = mapKeys(req.body || {}, (value, key) => mapKeysToOrca[key] || key);

  const { statusCode, body } = await got.post(
    `${orcaApiUri}/${req.path}`,
    {
      json: requestBody,
      responseType: 'json',
      throwHttpErrors: false,
    }
  );

  if (statusCode === 200) return res.send(body);

  logger.error(`postToOrca failed: ${JSON.stringify(body)}`);
  if (statusCode === 404) return res.boom.notFound(JSON.stringify(body));
  return res.boom.badRequest(JSON.stringify(body));
}

router.get('/recovery', listRequests);
router.post('/*', postToOrca);

module.exports = router;
