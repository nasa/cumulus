'use strict';

const get = require('lodash/get');
const semver = require('semver');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const log = require('@cumulus/common/log');
const {
  getKnexClient,
  tableNames,
  doesRecordExist,
} = require('@cumulus/db');
const {
  getMessageAsyncOperationId,
} = require('@cumulus/message/AsyncOperations');
const {
  getCollectionNameAndVersionFromMessage,
} = require('@cumulus/message/Collections');
const {
  getMessageExecutionArn,
  getMessageExecutionParentArn,
  getMessageCumulusVersion,
} = require('@cumulus/message/Executions');
const {
  getMessagePdrName,
} = require('@cumulus/message/PDRs');
const {
  getMessageProviderId,
} = require('@cumulus/message/Providers');
const {
  getWorkflowStatus,
} = require('@cumulus/message/workflows');
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

const hasNoParentExecutionOrExists = async (cumulusMessage, knex) => {
  const parentArn = getMessageExecutionParentArn(cumulusMessage);
  if (!parentArn) {
    return true;
  }
  return doesRecordExist({
    arn: parentArn,
  }, knex, tableNames.executions);
};

const hasNoAsyncOpOrExists = async (cumulusMessage, knex) => {
  const asyncOperationId = getMessageAsyncOperationId(cumulusMessage);
  if (!asyncOperationId) {
    return true;
  }
  return doesRecordExist({
    id: asyncOperationId,
  }, knex, tableNames.asyncOperations);
};

const hasNoCollectionOrExists = async (cumulusMessage, knex) => {
  const collectionInfo = getCollectionNameAndVersionFromMessage(cumulusMessage);
  if (!collectionInfo) {
    return true;
  }
  return doesRecordExist(collectionInfo, knex, tableNames.collections);
};

const hasNoProviderOrExists = async (cumulusMessage, knex) => {
  const providerId = getMessageProviderId(cumulusMessage);
  if (!providerId) {
    return true;
  }
  return doesRecordExist({
    name: providerId,
  }, knex, tableNames.providers);
};

const shouldWriteExecutionToRDS = async (
  cumulusMessage,
  isExecutionPostDeployment,
  knex
) => {
  try {
    if (!isExecutionPostDeployment) return false;

    const results = await Promise.all([
      hasNoParentExecutionOrExists(cumulusMessage, knex),
      hasNoAsyncOpOrExists(cumulusMessage, knex),
      hasNoCollectionOrExists(cumulusMessage, knex),
    ]);
    return results.every((result) => result === true);
  } catch (error) {
    log.error(error);
    return false;
  }
};

const saveExecution = async (cumulusMessage, isExecutionRDSWriteEnabled, knex) => {
  const executionModel = new Execution();

  if (!isExecutionRDSWriteEnabled) {
    return executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
  }

  return knex.transaction(async (trx) => {
    await trx(tableNames.executions)
      .insert({
        arn: getMessageExecutionArn(cumulusMessage),
        cumulus_version: getMessageCumulusVersion(cumulusMessage),
      });
    return executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
  });
};

const shouldWritePdrToRDS = async (
  isExecutionPostDeployment,
  isExecutionRDSWriteEnabled,
  collection,
  provider
) => {
  if (!isExecutionPostDeployment) return false;
  if (!isExecutionRDSWriteEnabled) return false;
  if (!collection || !provider) return false;
  return true;
};

const savePdr = async (
  cumulusMessage,
  isPdrRDSWriteEnabled,
  collection,
  provider,
  knex
) => {
  const pdrModel = new Pdr();

  if (!isPdrRDSWriteEnabled) {
    return pdrModel.storePdrFromCumulusMessage(cumulusMessage);
  }

  return knex.transaction(async (trx) => {
    await trx(tableNames.pdrs)
      .insert({
        name: getMessagePdrName(cumulusMessage),
        status: getWorkflowStatus(cumulusMessage),
        collectionCumulusId: collection.cumulusId,
        providerCumulusId: provider.cumulusId,
      });
    return pdrModel.storePdrFromCumulusMessage(cumulusMessage);
  });
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

const saveRecords = async (cumulusMessage, knex) => {
  const executionArn = getMessageExecutionArn(cumulusMessage);

  const isExecutionPostDeployment = isPostRDSDeploymentExecution(cumulusMessage);
  const [collection, provider] = await Promise.allSettled([
    knex(tableNames.collections).where(
      getCollectionNameAndVersionFromMessage(cumulusMessage)
    ).first(),
    knex(tableNames.providers).where({
      name: getMessageProviderId(cumulusMessage),
    }).first(),
  ]);

  const isExecutionRDSWriteEnabled = await shouldWriteExecutionToRDS(
    cumulusMessage,
    isExecutionPostDeployment,
    knex
  );
  const isPdrRDSWriteEnabled = await shouldWritePdrToRDS(
    isExecutionPostDeployment,
    isExecutionRDSWriteEnabled,
    collection,
    provider
  );

  try {
    await saveExecution(cumulusMessage, isExecutionRDSWriteEnabled, knex);
    // PDR write only attempted if execution saved
    await savePdr(
      cumulusMessage,
      isPdrRDSWriteEnabled,
      collection,
      provider,
      knex
    );
  } catch (error) {
    log.error(`Failed to write records for ${executionArn}`, error);
    throw error;
  }
};

const handler = async (event) => {
  const knex = await getKnexClient({
    env: {
      ...process.env,
      ...event.env,
    },
  });

  const sqsMessages = get(event, 'Records', []);

  return Promise.all(sqsMessages.map(async (message) => {
    const executionEvent = parseSQSMessageBody(message);
    const cumulusMessage = await getCumulusMessageFromExecutionEvent(executionEvent);

    try {
      await saveRecords(cumulusMessage, knex);
      return await saveGranulesToDb(cumulusMessage);
    } catch (error) {
      log.fatal(`Writing message failed: ${JSON.stringify(message)}`);
      return sendSQSMessage(process.env.DeadLetterQueue, message);
    }
  }));
};

module.exports = {
  handler,
  isPostRDSDeploymentExecution,
  hasNoParentExecutionOrExists,
  hasNoAsyncOpOrExists,
  hasNoCollectionOrExists,
  hasNoProviderOrExists,
  shouldWriteExecutionToRDS,
  saveExecution,
  saveGranulesToDb,
  savePdr,
};
