'use strict';

const get = require('lodash/get');
const semver = require('semver');
const pAll = require('p-all');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const log = require('@cumulus/common/log');
const { getKnexClient } = require('@cumulus/db');
const {
  getMessageExecutionArn,
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

const saveExecutionToDynamoDb = async (cumulusMessage, executionModel) =>
  executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

const deleteExecutionFromRDS = async (executionArn, knex) => {
  return knex('executions')
    .where({
      arn: executionArn,
    })
    .delete();
};

// Just a stub for write functionality
const saveExecutionToRDS = async (cumulusMessage, knex) => {
  const executionArn = getMessageExecutionArn(cumulusMessage);
  return knex('executions').insert({
    arn: executionArn,
  });
};

const saveExecutions = async (cumulusMessage, knex) => {
  const executionModel = new Execution();
  const executionArn = getMessageExecutionArn(cumulusMessage);
  try {
    await pAll([
      () => saveExecutionToDynamoDb(cumulusMessage, executionModel),
      () => saveExecutionToRDS(cumulusMessage, knex),
    ], {
      // let all promises settle before throwing error
      stopOnError: false,
    });
  } catch (error) {
    log.error(`Failed to write execution records for ${executionArn}`, error);
    await Promise.all([
      executionModel.delete({ arn: executionArn }),
      deleteExecutionFromRDS(executionArn, knex),
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
    const results = await Promise.allSettled([
      saveExecutions(cumulusMessage, knex),
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
  isPostRDSDeploymentExecution,
  saveExecutionToDynamoDb,
  saveExecutionToRDS,
  saveExecutions,
  saveGranulesToDb,
  savePdrToDb,
};
