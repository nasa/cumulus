'use strict';

const router = require('express-promise-router')();
const aws = require('@cumulus/common/aws'); // important to import all to allow stubbing
const { StepFunction } = require('@cumulus/ingest/aws');
const { executionExists } = require('@cumulus/common/step-functions');
const { RecordDoesNotExist } = require('../lib/errors');
const models = require('../models');

/**
 * fetchRemote fetches remote message from S3
 *
 * @param  {Object} eventMessage - Cumulus Message Adapter message
 * @returns {string}              Cumulus Message Adapter message in JSON string
 */
async function fetchRemote(eventMessage) {
  if (eventMessage.replace) {
    const file = await aws.getS3Object(eventMessage.replace.Bucket, eventMessage.replace.Key);
    return file.Body.toString();
  }

  return JSON.stringify(eventMessage);
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
  let result = Object.assign({}, event);
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

  // if the execution exists in SFN API, retrieve its information, if not, get from database
  if (await executionExists(arn)) {
    const status = await StepFunction.getExecutionStatus(arn);

    // if execution output is stored remotely, fetch it from S3 and replace it
    const executionOutput = status.execution.output;

    if (executionOutput) {
      status.execution.output = await fetchRemote(JSON.parse(status.execution.output));
    }
    const updatedEvents = [];
    for (let i = 0; i < status.executionHistory.events.length; i += 1) {
      const sfEvent = status.executionHistory.events[i];
      updatedEvents.push(getEventDetails(sfEvent));
    }
    status.executionHistory.events = await Promise.all(updatedEvents);
    return res.send(status);
  }

  // get the execution information from database
  let response;
  const e = new models.Execution();
  try {
    response = await e.get({ arn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('Execution not found in API or database');
    }
  }

  const warning = 'Execution does not exist in Step Functions API';
  const execution = {
    executionArn: response.arn,
    stateMachineArn: aws.getStateMachineArn(response.arn),
    name: response.name,
    status: response.status === 'completed' ? 'SUCCEEDED' : response.status.toUpperCase(),
    startDate: new Date(response.createdAt),
    stopDate: new Date(response.createdAt + response.duration * 1000),
    ...{ input: JSON.stringify(response.originalPayload) },
    ...{ output: JSON.stringify(response.finalPayload) }
  };
  return res.send({ warning, execution });
}

router.get('/:arn', get);

module.exports = router;
