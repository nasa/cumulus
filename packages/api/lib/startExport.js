//@ts-check

'use strict';

const { v4: uuidv4 } = require('uuid');
const Logger = require('@cumulus/logger');
const startAsyncOperation = require('./startAsyncOperation');
const { getFunctionNameFromRequestContext } = require('./request');

const log = new Logger({ sender: '@cumulus/api/startExport' });

/**
 * Start an 'Export Table' AsyncOperation for the given resource type.
 *
 * Accepts the same `queryStringParameters` shape (filters/sort) that the
 * resource's `GET` list endpoint accepts, so the export mirrors exactly
 * what the caller can already search/filter on.
 *
 * @param {Object} params
 * @param {string} params.resourceType - one of 'granule'|'execution'|'collection'|'provider'|'pdr'
 * @param {import('express').Request} params.req - express request object;
 *   `req.body.queryStringParameters` is forwarded to the export worker
 * @param {import('express').Response} params.res - express response object
 * @returns {Promise<unknown>} the promise of the express response object
 */
async function startExportOperation({ resourceType, req, res }) {
  const queryStringParameters = (req.body && req.body.queryStringParameters) || {};

  const asyncOperationId = uuidv4();
  const asyncOperationEvent = {
    asyncOperationId,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.ExportTableLambda,
    description: `Export ${resourceType} records to CSV`,
    operationType: 'Export Table',
    payload: {
      resourceType,
      queryStringParameters,
    },
  };

  log.debug(
    `About to invoke lambda to start export async operation ${asyncOperationId}`
  );
  await startAsyncOperation.invokeStartAsyncOperationLambda(asyncOperationEvent);
  return res.status(202).send({ id: asyncOperationId });
}

module.exports = {
  startExportOperation,
};
