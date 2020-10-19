'use strict';

const get = require('lodash/get');
const semver = require('semver');
const pAll = require('p-all');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const log = require('@cumulus/common/log');
const { getKnexClient } = require('@cumulus/db');
const {
  getMessageExecutionArn,
  getMessageExecutionParentArn,
} = require('@cumulus/message/Executions');
const Execution = require('../models/executions');
const Granule = require('../models/granules');
const Pdr = require('../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../lib/cwSfExecutionEventUtils');

const isPostRDSDeploymentExecution = (cumulusMessage) => {
  const cumulusVersion = get(cumulusMessage, 'cumulus_meta.cumulus_version', '0.0.0');
  // TODO: don't hardcode 3.0.0?
  return semver.gte(cumulusVersion, '3.0.0');
};

/**
 * Get the initial execution message for a chain of workflows.
 *
 * @param {Object} cumulusMessage - A Cumulus workflow message
 * @returns {Object}
 *   Cumulus workflow message for the parent execution initiating
 *   this chain of executions.
 */
const getInitialExecutionMessage = async (cumulusMessage) => {
  const parentArn = getMessageExecutionParentArn(cumulusMessage);
  if (!parentArn) {
    return cumulusMessage;
  }
  const executionArn = getMessageExecutionArn(cumulusMessage);
  const response = await StepFunctions.describeExecution({
    executionArn,
  });
  return getInitialExecutionMessage(JSON.parse(response.input));
};

const shouldWriteToRDS = async (cumulusMessage) => {
  const initialMessage = await getInitialExecutionMessage(cumulusMessage);
  return isPostRDSDeploymentExecution(initialMessage);
};

const saveExecutionToDynamoDb = async (cumulusMessage, executionModel) =>
  executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

const deleteExecutionFromRDS = async (isRDSWriteEnabled, executionArn, knex) => {
  if (!isRDSWriteEnabled) return true;
  return knex('executions')
    .where({
      arn: executionArn,
    })
    .delete();
};

// Just a stub for write functionality
const saveExecutionToRDS = async (isRDSWriteEnabled, cumulusMessage, knex) => {
  if (!isRDSWriteEnabled) return true;
  const executionArn = getMessageExecutionArn(cumulusMessage);
  return knex('executions').insert({
    arn: executionArn,
  });
};

const saveExecutions = async (cumulusMessage, isRDSWriteEnabled, knex) => {
  const executionModel = new Execution();
  const executionArn = getMessageExecutionArn(cumulusMessage);
  try {
    await pAll([
      () => saveExecutionToDynamoDb(cumulusMessage, executionModel),
      () => saveExecutionToRDS(isRDSWriteEnabled, cumulusMessage, knex),
    ], {
      // let all promises settle before throwing error so that we know
      // all writes have either failed/succeeded
      stopOnError: false,
    });
  } catch (error) {
    log.error(`Failed to write execution records for ${executionArn}`, error);
    await Promise.all([
      executionModel.delete({ arn: executionArn }),
      deleteExecutionFromRDS(isRDSWriteEnabled, executionArn, knex),
    ]);
  }
};

const savePdrToDb = async (cumulusMessage) => {
  const pdrModel = new Pdr();
  try {
    await pdrModel.storePdrFromCumulusMessage(cumulusMessage);
  } catch (error) {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    log.fatal(`Failed to create/update PDR database record for execution ${executionArn}: ${error.message}`);
    throw error;
  }
};

const saveGranulesToDb = async (cumulusMessage) => {
  const granuleModel = new Granule();

  try {
    await granuleModel.storeGranulesFromCumulusMessage(cumulusMessage);
  } catch (error) {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    log.fatal(`Failed to create/update granule records for execution ${executionArn}: ${error.message}`);
    throw error;
  }
};

const handler = async (event) => {
  const env = event.env ? event.env : process.env;

  const knex = await getKnexClient({ env });

  const sqsMessages = get(event, 'Records', []);

  return Promise.all(sqsMessages.map(async (message) => {
    const executionEvent = parseSQSMessageBody(message);
    const cumulusMessage = await getCumulusMessageFromExecutionEvent(executionEvent);
    const isRDSWriteEnabled = await shouldWriteToRDS(cumulusMessage);
    const results = await Promise.allSettled([
      saveExecutions(cumulusMessage, isRDSWriteEnabled, knex),
      saveGranulesToDb(cumulusMessage),
      savePdrToDb(cumulusMessage),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      log.fatal(`Writing message failed: ${JSON.stringify(message)}`);
      return sendSQSMessage(process.env.DeadLetterQueue, message);
    }
    return results;
  }));
};

module.exports = {
  handler,
  getInitialExecutionMessage,
  isPostRDSDeploymentExecution,
  shouldWriteToRDS,
  saveExecutionToDynamoDb,
  saveExecutionToRDS,
  saveExecutions,
  saveGranulesToDb,
  savePdrToDb,
};
