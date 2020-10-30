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

const getMessageCollection = async (cumulusMessage, knex) => {
  try {
    const collectionNameAndVersion = getCollectionNameAndVersionFromMessage(cumulusMessage);
    if (!collectionNameAndVersion) {
      throw new Error('Could not find collection name/version in message');
    }
    return await knex(tableNames.collections).where(
      collectionNameAndVersion
    ).first();
  } catch (error) {
    log.error(error);
    return undefined;
  }
};

const getMessageProvider = async (cumulusMessage, knex) => {
  try {
    const providerId = getMessageProviderId(cumulusMessage);
    if (!providerId) {
      throw new Error('Could not find provider ID in message');
    }
    return await knex(tableNames.providers).where({
      name: getMessageProviderId(cumulusMessage),
    }).first();
  } catch (error) {
    log.error(error);
    return undefined;
  }
};

const shouldWriteExecutionToRDS = async (
  cumulusMessage,
  collection,
  knex
) => {
  try {
    const isExecutionPostDeployment = isPostRDSDeploymentExecution(cumulusMessage);
    if (!isExecutionPostDeployment) return false;
    if (!collection) return false;

    const results = await Promise.all([
      hasNoParentExecutionOrExists(cumulusMessage, knex),
      hasNoAsyncOpOrExists(cumulusMessage, knex),
    ]);
    return results.every((result) => result === true);
  } catch (error) {
    log.error(error);
    return false;
  }
};

const saveExecutionViaTransaction = async ({ cumulusMessage, trx }) =>
  trx(tableNames.executions)
    .insert({
      arn: getMessageExecutionArn(cumulusMessage),
      cumulus_version: getMessageCumulusVersion(cumulusMessage),
    });

const saveExecution = async ({ cumulusMessage, knex }) => {
  const executionModel = new Execution();

  return knex.transaction(async (trx) => {
    await saveExecutionViaTransaction({ cumulusMessage, trx });
    return executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
  });
};

const savePdrViaTransaction = async ({
  cumulusMessage,
  collection,
  provider,
  trx,
}) =>
  trx(tableNames.pdrs)
    .insert({
      name: getMessagePdrName(cumulusMessage),
      status: getWorkflowStatus(cumulusMessage),
      collectionCumulusId: collection.cumulusId,
      providerCumulusId: provider.cumulusId,
    });

const savePdr = async ({
  cumulusMessage,
  collection,
  provider,
  knex,
  pdrModel = new Pdr(),
}) => {
  // const pdrModel = new Pdr();

  return knex.transaction(async (trx) => {
    await savePdrViaTransaction({ cumulusMessage, collection, provider, trx });
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

const saveRecordsToDynamoDb = async (cumulusMessage) => {
  const executionModel = new Execution();
  const pdrModel = new Pdr();

  const results = await Promise.allSettled([
    executionModel.storeExecutionFromCumulusMessage(cumulusMessage),
    pdrModel.storePdrFromCumulusMessage(cumulusMessage),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const allFailures = failures.map((failure) => failure.reason);
    log.error(allFailures.join(' '));
    throw new Error('Failed writing some records to Dynamo');
  }
  return results;
};

const saveRecords = async (cumulusMessage, knex) => {
  const executionArn = getMessageExecutionArn(cumulusMessage);

  const collection = await getMessageCollection(cumulusMessage, knex);
  const isExecutionRDSWriteEnabled = await shouldWriteExecutionToRDS(
    cumulusMessage,
    collection,
    knex
  );

  // If execution is not written to RDS, then PDRs/granules which reference
  // execution should not be written to RDS either
  if (!isExecutionRDSWriteEnabled) {
    return saveRecordsToDynamoDb(cumulusMessage);
  }

  const provider = await getMessageProvider(cumulusMessage, knex);

  try {
    await saveExecution({
      cumulusMessage,
      knex,
    });
    // PDR write only attempted if execution saved
    if (collection && provider) {
      await savePdr({
        cumulusMessage,
        collection,
        provider,
        knex,
      });
    }
    return true;
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
  getMessageCollection,
  getMessageProvider,
  shouldWriteExecutionToRDS,
  saveExecution,
  saveGranulesToDb,
  savePdr,
};
