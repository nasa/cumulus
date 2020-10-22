'use strict';

const get = require('lodash/get');
const semver = require('semver');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const log = require('@cumulus/common/log');
const {
  getKnexClient,
  Executions,
} = require('@cumulus/db');
const {
  getMessageExecutionArn,
  getMessageExecutionParentArn,
  getMessageCumulusVersion,
} = require('@cumulus/message/Executions');
const Execution = require('../models/executions');
const Granule = require('../models/granules');
const Pdr = require('../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../lib/cwSfExecutionEventUtils');

const isPostRDSDeploymentExecution = (cumulusMessage) => {
  const minimumSupportedRDSVersion = process.env.RDS_DEPLOYMENT_CUMULUS_VERSION;
  if (!minimumSupportedRDSVersion) {
    throw new Error('RDS_DEPLOYMENT_CUMULUS_VERSION environment variable must be set');
  }
  const cumulusVersion = getMessageCumulusVersion(cumulusMessage);
  return cumulusVersion
    ? semver.gte(cumulusVersion, minimumSupportedRDSVersion)
    : false;
};

const doesExecutionExistInRDS = async (params, executionDbClient) =>
  await executionDbClient.where(params).first() !== undefined;

const shouldWriteExecutionToRDS = async (cumulusMessage, executionDbClient) => {
  const executionIsPostDeployment = isPostRDSDeploymentExecution(cumulusMessage);
  const parentArn = getMessageExecutionParentArn(cumulusMessage);
  if (!executionIsPostDeployment || !parentArn) return executionIsPostDeployment;
  return doesExecutionExistInRDS({
    arn: parentArn,
  }, executionDbClient);
};

const saveExecutions = async (cumulusMessage, knex) => {
  const executionModel = new Execution();
  const executionArn = getMessageExecutionArn(cumulusMessage);
  const executionDbClient = Executions.getDbClient(knex);

  const isRDSWriteEnabled = await shouldWriteExecutionToRDS(cumulusMessage, executionDbClient);

  if (!isRDSWriteEnabled) {
    return executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
  }

  try {
    return await knex.transaction(async (trx) => {
      await Executions.getDbTransaction(trx)
        .insert({
          arn: executionArn,
          cumulusVersion: getMessageCumulusVersion(cumulusMessage),
        });
      return executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
    });
  } catch (error) {
    log.error(`Failed to write execution records for ${executionArn}`, error);
    return Promise.resolve();
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
  shouldWriteExecutionToRDS,
  saveExecutions,
  saveGranulesToDb,
  savePdrToDb,
};
