'use strict';

const router = require('express-promise-router')();
const moment = require('moment');
const { getStateMachineArnFromExecutionArn } = require('@cumulus/message/Executions');
const { pullStepFunctionEvent } = require('@cumulus/message/StepFunctions');
const S3ObjectStore = require('@cumulus/aws-client/S3ObjectStore');
const { buildS3Uri, s3PutObject } = require('@cumulus/aws-client/S3');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const {
  getApiGranuleExecutionCumulusIdsByExecution,
  getKnexClient,
  GranulePgModel,
  ExecutionPgModel,
  CollectionPgModel,
  translatePostgresGranuleToApiGranule,
} = require('@cumulus/db');
const { filenamify } = require('../lib/utils');

const logger = new Logger({ sender: '@cumulus/api/execution-status' });
const maxResponsePayloadSizeBytes = 6 * 1000 * 1000;

/**
 * fetchRemote fetches remote message from S3
 *
 * @param  {Object} eventMessage - Cumulus Message Adapter message
 * @returns {string}              Cumulus Message Adapter message in JSON string
 */
async function fetchRemote(eventMessage) {
  const updatedEventMessage = await pullStepFunctionEvent(eventMessage);
  return JSON.stringify(updatedEventMessage);
}

/**
 * return a presigned S3 url for execution status
 * @param {Object} executionStatus - execution status
 * @returns {string} presigned S3 url
 */
async function createPresignedS3UrlForExecutionStatus(executionStatus) {
  const systemBucket = process.env.system_bucket;
  const stackName = process.env.stackName;
  const formatString = 'YYYYMMDDTHHmmssSSS';
  const key = `${stackName}/data/execution-status/${filenamify(executionStatus.execution.name)}-${moment.utc().format(formatString)}.json`;
  const downloadFile = key.split('/').pop();
  // the s3 object will be deleted by the life cyle policy on the bucket based on prefix
  await s3PutObject({
    Bucket: systemBucket,
    Key: key,
    Body: JSON.stringify(executionStatus, undefined, 2),
  });

  const s3ObjectUrl = buildS3Uri(systemBucket, key);
  const s3ObjectStoreClient = new S3ObjectStore();
  const presignedS3Url = await s3ObjectStoreClient.signGetObject(
    s3ObjectUrl,
    {
      ResponseContentDisposition: `attachment; filename="${downloadFile}"`,
    }
  );

  return presignedS3Url;
}

/**
 * getEventDetails
 *   - replaces StepFunction-specific keys with input or output keys
 *   - replaces "replace" key in input or output with message stored on S3
 *
 * @param  {Object} event - StepFunction event object
 * @returns {Object}       StepFunction event object, with SFn keys and
 *                        "replace" values replaced with "input|output"
 *                        and message stored on S3, respectively.
 */
async function getEventDetails(event) {
  let result = { ...event };
  let prop;

  if (event.type.endsWith('StateEntered')) {
    prop = 'stateEnteredEventDetails';
  } else if (event.type.endsWith('StateExited')) {
    prop = 'stateExitedEventDetails';
  } else if (event.type) {
    prop = `${event.type.charAt(0).toLowerCase() + event.type.slice(1)}EventDetails`;
  }

  if (prop && event[prop]) {
    result = Object.assign(result, event[prop]);
    delete result[prop];
  }

  if (result.input) result.input = await fetchRemote(JSON.parse(result.input));
  if (result.output) result.output = await fetchRemote(JSON.parse(result.output));

  return result;
}

/**
 * get a single execution status
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const arn = req.params.arn;
  const knex = await getKnexClient({ env: process.env });
  const granulePgModel = new GranulePgModel();
  const collectionPgModel = new CollectionPgModel();
  const executionPgModel = new ExecutionPgModel();
  let isInDatabase = true;
  let mappedGranules;

  // get the execution information from database
  let response;
  try {
    response = await executionPgModel.get(knex, { arn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      isInDatabase = false;
    }
  }

  if (isInDatabase) {
    // include associated granules
    const granuleCumulusIds = await getApiGranuleExecutionCumulusIdsByExecution(knex, [response]);
    const granules = await granulePgModel.searchByCumulusIds(knex, granuleCumulusIds);
    const apiGranules = await Promise.all(granules
      .map(async (pgGranule) => {
        const pgCollection = await collectionPgModel.get(
          knex,
          { cumulus_id: pgGranule.collection_cumulus_id }
        );

        return await translatePostgresGranuleToApiGranule({
          granulePgRecord: pgGranule,
          collectionPgRecord: pgCollection,
          knexOrTransaction: knex,
        });
      }));
    mappedGranules = apiGranules.map((granule) =>
      ({ granuleId: granule.granuleId, collectionId: granule.collectionId }));
  }

  // if the execution exists in SFN API, retrieve its information, if not, get from database
  if (await StepFunctions.executionExists(arn)) {
    const status = await StepFunctions.getExecutionStatus(arn);

    // if execution output is stored remotely, fetch it from S3 and replace it
    if (status.execution.output) {
      status.execution.output = await fetchRemote(JSON.parse(status.execution.output));
    }
    const updatedEvents = [];
    for (let i = 0; i < status.executionHistory.events.length; i += 1) {
      const sfEvent = status.executionHistory.events[i];
      updatedEvents.push(getEventDetails(sfEvent));
    }
    status.executionHistory.events = await Promise.all(updatedEvents);
    status.execution.granules = mappedGranules;

    const presignedS3Url = await createPresignedS3UrlForExecutionStatus(status);
    // estimated payload size, add extra
    const objectString = JSON.stringify(status, undefined, 2);
    const estimatedPayloadSize = presignedS3Url.length + objectString.length + 50;
    logger.debug(`Sending json file with contentLength ${objectString.length}`);
    let data = status;
    if (estimatedPayloadSize
        > (process.env.maxResponsePayloadSizeBytes || maxResponsePayloadSizeBytes)
    ) {
      data = `Error: Execution Status for ${status.execution.name} exceeded maximum allowed payload size`;
    }
    return res.send({ presignedS3Url, data });
  }

  if (!isInDatabase) {
    return res.boom.notFound(`Execution record with identifiers ${JSON.stringify(req.params)} does not exist.`);
  }

  const warning = 'Execution does not exist in Step Functions API';
  const name = response.name || arn.split(':').pop();
  const execution = {
    executionArn: arn,
    stateMachineArn: getStateMachineArnFromExecutionArn(arn),
    name,
    status: response.status === 'completed' ? 'SUCCEEDED' : response.status.toUpperCase(),
    startDate: response.created_at,
    stopDate: new Date(response.created_at.getTime() + response.duration * 1000),
    granules: mappedGranules,
    ...(response.original_payload && { input: JSON.stringify(response.original_payload) }),
    ...(response.final_payload && { output: JSON.stringify(response.final_payload) }),
  };
  const data = { execution };
  const presignedS3Url = await createPresignedS3UrlForExecutionStatus(data);
  return res.send({ warning, presignedS3Url, data });
}

router.get('/:arn', get);

module.exports = router;
