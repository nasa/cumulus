'use strict';

const get = require('lodash/get');
const semver = require('semver');
const AggregateError = require('aggregate-error');

const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const log = require('@cumulus/common/log');
const { envUtils } = require('@cumulus/common');
const {
  getKnexClient,
  tableNames,
  doesRecordExist,
  isRecordDefined,
} = require('@cumulus/db');
const { MissingRequiredEnvVar } = require('@cumulus/errors');
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
  getMessageGranules,
  messageHasGranules,
} = require('@cumulus/message/Granules');
const {
  getMessagePdrName,
  messageHasPdr,
} = require('@cumulus/message/PDRs');
const {
  getMessageProviderId,
} = require('@cumulus/message/Providers');
const {
  getMetaStatus,
} = require('@cumulus/message/workflows');
const Execution = require('../models/executions');
const Granule = require('../models/granules');
const Pdr = require('../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../lib/cwSfExecutionEventUtils');

const isPostRDSDeploymentExecution = (cumulusMessage) => {
  try {
    const minimumSupportedRDSVersion = envUtils.getRequiredEnvVar('RDS_DEPLOYMENT_CUMULUS_VERSION');
    const cumulusVersion = getMessageCumulusVersion(cumulusMessage);
    return cumulusVersion
      ? semver.gte(cumulusVersion, minimumSupportedRDSVersion)
      : false;
  } catch (error) {
    // Throw error to fail lambda if required env var is missing
    if (error instanceof MissingRequiredEnvVar) {
      throw error;
    }
    // Treat other errors as false
    return false;
  }
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
  const isExecutionPostDeployment = isPostRDSDeploymentExecution(cumulusMessage);
  if (!isExecutionPostDeployment) return false;

  try {
    if (!isRecordDefined(collection)) return false;

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

const writeExecutionViaTransaction = async ({ cumulusMessage, trx }) =>
  trx(tableNames.executions)
    .insert({
      arn: getMessageExecutionArn(cumulusMessage),
      cumulus_version: getMessageCumulusVersion(cumulusMessage),
      status: getMetaStatus(cumulusMessage),
    })
    .returning('cumulusId');

const writeExecution = async ({
  cumulusMessage,
  knex,
  executionModel = new Execution(),
}) =>
  knex.transaction(async (trx) => {
    const [cumulusId] = await writeExecutionViaTransaction({ cumulusMessage, trx });
    await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
    return cumulusId;
  });

const writePdrViaTransaction = async ({
  cumulusMessage,
  collection,
  provider,
  trx,
  executionCumulusId,
}) =>
  trx(tableNames.pdrs)
    .insert({
      name: getMessagePdrName(cumulusMessage),
      status: getMetaStatus(cumulusMessage),
      collectionCumulusId: collection.cumulusId,
      providerCumulusId: provider.cumulusId,
      executionCumulusId,
    })
    .returning('cumulusId');

const writePdr = async ({
  cumulusMessage,
  collection,
  provider,
  knex,
  executionCumulusId,
  pdrModel = new Pdr(),
}) => {
  // If there is no PDR in the message, then there's nothing to do here, which is fine
  if (!messageHasPdr(cumulusMessage)) {
    return undefined;
  }
  if (!isRecordDefined(collection)) {
    throw new Error(`Collection reference is required for a PDR, got ${collection}`);
  }
  if (!isRecordDefined(provider)) {
    throw new Error(`Provider reference is required for a PDR, got ${provider}`);
  }
  return knex.transaction(async (trx) => {
    const [cumulusId] = await writePdrViaTransaction({
      cumulusMessage,
      collection,
      provider,
      trx,
      executionCumulusId,
    });
    await pdrModel.storePdrFromCumulusMessage(cumulusMessage);
    return cumulusId;
  });
};

const writeGranuleViaTransaction = async ({
  cumulusMessage,
  granule,
  collection,
  provider,
  trx,
}) =>
  trx(tableNames.granules)
    .insert({
      granuleId: granule.granuleId,
      status: getMetaStatus(cumulusMessage) || granule.status,
      collectionCumulusId: collection.cumulusId,
      providerCumulusId: provider ? provider.cumulusId : undefined,
    });

const writeGranules = async ({
  cumulusMessage,
  collection,
  provider,
  knex,
  granuleModel = new Granule(),
}) => {
  // If there are no granules in the message, then there's nothing to do here, which is fine
  if (!messageHasGranules(cumulusMessage)) {
    return true;
  }
  if (!isRecordDefined(collection)) {
    throw new Error(`Collection reference is required for granules, got ${collection}`);
  }
  // if (!isRecordDefined(provider)) {
  //   throw new Error(`Provider reference is required for a PDR, got ${provider}`);
  // }
  return knex.transaction(async (trx) => {
    // TODO: should write of each granule to Dynamo/RDS be done in a transaction per granule,
    // rather than one transaction for all granules to Dynamo/RDS? A transaction per granule
    // would allow write of each granule to succeed or fail independently
    await Promise.all(getMessageGranules(cumulusMessage).map(
      (granule) => writeGranuleViaTransaction({
        cumulusMessage,
        granule,
        collection,
        provider,
        trx,
      })
    ));
    return granuleModel.storeGranulesFromCumulusMessage(cumulusMessage);
  });
};

const writeRecordsToDynamoDb = async (cumulusMessage) => {
  const executionModel = new Execution();
  const pdrModel = new Pdr();
  const granuleModel = new Granule();

  const results = await Promise.allSettled([
    executionModel.storeExecutionFromCumulusMessage(cumulusMessage),
    pdrModel.storePdrFromCumulusMessage(cumulusMessage),
    granuleModel.storeGranulesFromCumulusMessage(cumulusMessage),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const allFailures = failures.map((failure) => failure.reason);
    const aggregateError = new AggregateError(allFailures);
    log.error('Failed writing some records to Dynamo', aggregateError);
    throw aggregateError;
  }
  return results;
};

const writeRecords = async (cumulusMessage, knex) => {
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
    return writeRecordsToDynamoDb(cumulusMessage);
  }

  const provider = await getMessageProvider(cumulusMessage, knex);

  try {
    const executionCumulusId = await writeExecution({
      cumulusMessage,
      knex,
    });
    // PDR write only attempted if execution saved
    const pdrCumulusId = await writePdr({
      cumulusMessage,
      collection,
      provider,
      knex,
      executionCumulusId,
    });
    return await writeGranules({
      cumulusMessage,
      collection,
      provider,
      knex,
      pdrCumulusId,
    });
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
      return await writeRecords(cumulusMessage, knex);
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
  writeGranuleViaTransaction,
  writeGranules,
  writeExecution,
  writePdr,
  writeRecords,
};
