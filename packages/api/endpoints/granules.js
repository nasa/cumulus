'use strict';

const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const {
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse
} = require('../lib/response');
const Search = require('../es/search').Search;
const models = require('../models');
const {
  InternalServerError,
  NotFoundResponse
} = require('../lib/responses');
const { deconstructCollectionId } = require('../lib/utils');

/**
 * List all granules for a given collection.
 *
 * @param {Object} event - aws lambda event object.
 * @returns {Promise<Object>} a Lambda Proxy response object
 */
async function list(event) {
  const result = await (new Search(event, 'granule')).query();

  return buildLambdaProxyResponse({
    json: true,
    body: result
  });
}

/**
 * Update a single granule.
 * Supported Actions: reingest, move, applyWorkflow, RemoveFromCMR.
 *
 * @param {Object} event - aws lambda event object.
 * @returns {Promise<Object>} a Lambda Proxy response object
 */
async function put(event) {
  const granuleId = event.pathParameters.granuleName;
  const body = event.body ? JSON.parse(event.body) : {};
  const action = body.action;

  if (!action) {
    return buildLambdaProxyResponse({
      json: true,
      statusCode: 400,
      body: { message: 'Action is missing' }
    });
  }

  const granuleModelClient = new models.Granule();
  const granule = await granuleModelClient.get({ granuleId });

  if (action === 'reingest') {
    const { name, version } = deconstructCollectionId(granule.collectionId);
    const collectionModelClient = new models.Collection();
    const collection = await collectionModelClient.get({ name, version });

    await granuleModelClient.reingest(granule);

    const warning = 'The granule files may be overwritten';

    return buildLambdaProxyResponse({
      json: true,
      body: Object.assign({
        granuleId: granule.granuleId,
        action,
        status: 'SUCCESS'
      },
      (collection.duplicateHandling !== 'replace') ? { warning } : {})
    });
  }

  if (action === 'applyWorkflow') {
    await granuleModelClient.applyWorkflow(
      granule,
      body.workflow
    );

    return buildLambdaProxyResponse({
      json: true,
      body: {
        granuleId: granule.granuleId,
        action: `applyWorkflow ${body.workflow}`,
        status: 'SUCCESS'
      }
    });
  }

  if (action === 'removeFromCmr') {
    await granuleModelClient.removeGranuleFromCmr(granule.granuleId, granule.collectionId);

    return buildLambdaProxyResponse({
      json: true,
      body: {
        granuleId: granule.granuleId,
        action,
        status: 'SUCCESS'
      }
    });
  }

  if (action === 'move') {
    const filesAtDestination = await granuleModelClient.getFilesExistingAtLocation(
      granule,
      body.destinations
    );

    if (filesAtDestination.length > 0) {
      const filenames = filesAtDestination.map((file) => file.name);
      const message = `Cannot move granule because the following files would be overwritten at the destination location: ${filenames.join(', ')}. Delete the existing files or reingest the source files.`;

      return buildLambdaProxyResponse({
        json: true,
        statusCode: 409,
        body: { message }
      });
    }

    await granuleModelClient.move(granule, body.destinations, process.env.DISTRIBUTION_ENDPOINT);

    return buildLambdaProxyResponse({
      json: true,
      body: {
        granuleId: granule.granuleId,
        action,
        status: 'SUCCESS'
      }
    });
  }

  return buildLambdaProxyResponse({
    json: true,
    statusCode: 400,
    body: { message: 'Action is not supported. Choices are "applyWorkflow", "move", "reingest", or "removeFromCmr"' }
  });
}

/**
 * Delete a granule
 *
 * @param {Object} event - aws lambda event object.
 * @returns {Promise<Object>} a Lambda Proxy response object
 */
async function del(event) {
  const granuleId = event.pathParameters.granuleName;
  log.info(`granules.del ${granuleId}`);

  const granuleModelClient = new models.Granule();
  const granule = await granuleModelClient.get({ granuleId });

  if (granule.detail) {
    return buildLambdaProxyResponse({
      json: true,
      statusCode: 400,
      body: granule
    });
  }

  if (granule.published) {
    return buildLambdaProxyResponse({
      json: true,
      statusCode: 400,
      body: { message: 'You cannot delete a granule that is published to CMR. Remove it from CMR first' }
    });
  }

  // remove files from s3
  await Promise.all(granule.files.map((file) => {
    if (!file.filename) return {};
    const parsed = aws.parseS3Uri(file.filename);
    if (aws.fileExists(parsed.Bucket, parsed.Key)) {
      return aws.deleteS3Object(parsed.Bucket, parsed.Key);
    }
    return {};
  }));

  await granuleModelClient.delete({ granuleId });

  return buildLambdaProxyResponse({
    json: true,
    body: { detail: 'Record deleted' }
  });
}

/**
 * Query a single granule.
 *
 * @param {Object} event - aws lambda event object.
 * @returns {Promise<Object>} a Lambda Proxy response object
 */
async function get(event) {
  let result;
  try {
    result = await (new models.Granule()).get({ granuleId: event.pathParameters.granuleName });
  }
  catch (err) {
    if (err.message.startsWith('No record found')) {
      return new NotFoundResponse({
        json: true,
        body: { message: 'Granule not found' }
      });
    }

    throw err;
  }

  return buildLambdaProxyResponse({
    json: true,
    body: result
  });
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} request - AWS lambda event object.
 * @returns {Promise<Object>} a Lambda Proxy response object
 */
async function handleRequest(request) {
  // Determine what action to take
  let action;
  if (request.httpMethod === 'GET' && request.pathParameters) action = get;
  else if (request.httpMethod === 'PUT' && request.pathParameters) action = put;
  else if (request.httpMethod === 'DELETE' && request.pathParameters) action = del;
  else action = list;

  try {
    // Verify the user's credentials
    const authorizationFailureResponse = await getAuthorizationFailureResponse({
      request: request,
      usersTable: process.env.UsersTable
    });
    if (authorizationFailureResponse) return authorizationFailureResponse;

    // Perform the requested action
    return action(request);
  }
  catch (err) {
    log.error(err);
    return new InternalServerError();
  }
}

module.exports = handleRequest;
