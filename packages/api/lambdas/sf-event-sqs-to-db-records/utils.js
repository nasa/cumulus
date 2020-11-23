const semver = require('semver');
const { envUtils } = require('@cumulus/common');
const log = require('@cumulus/common/log');
const {
  tableNames,
  doesRecordExist,
  isRecordDefined,
} = require('@cumulus/db');
const { MissingRequiredEnvVarError } = require('@cumulus/errors');
const {
  getMessageAsyncOperationId,
} = require('@cumulus/message/AsyncOperations');
const {
  getCollectionNameAndVersionFromMessage,
} = require('@cumulus/message/Collections');
const {
  getMessageExecutionParentArn,
  getMessageCumulusVersion,
} = require('@cumulus/message/Executions');
const {
  getMessageProviderId,
} = require('@cumulus/message/Providers');

const isPostRDSDeploymentExecution = (cumulusMessage) => {
  try {
    const minimumSupportedRDSVersion = envUtils.getRequiredEnvVar('RDS_DEPLOYMENT_CUMULUS_VERSION');
    const cumulusVersion = getMessageCumulusVersion(cumulusMessage);
    return cumulusVersion
      ? semver.gte(cumulusVersion, minimumSupportedRDSVersion)
      : false;
  } catch (error) {
    // Throw error to fail lambda if required env var is missing
    if (error instanceof MissingRequiredEnvVarError) {
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

const getMessageCollectionCumulusId = async (cumulusMessage, knex) => {
  try {
    const collectionNameAndVersion = getCollectionNameAndVersionFromMessage(cumulusMessage);
    if (!collectionNameAndVersion) {
      throw new Error('Could not find collection name/version in message');
    }
    const collection = await knex(tableNames.collections).where(
      collectionNameAndVersion
    ).first();
    if (!isRecordDefined(collection)) {
      throw new Error(`Could not find collection with params ${JSON.stringify(collectionNameAndVersion)}`);
    }
    return collection.cumulus_id;
  } catch (error) {
    log.error(error);
    return undefined;
  }
};

const getMessageProviderCumulusId = async (cumulusMessage, knex) => {
  try {
    const providerId = getMessageProviderId(cumulusMessage);
    if (!providerId) {
      throw new Error('Could not find provider ID in message');
    }
    const searchParams = {
      name: getMessageProviderId(cumulusMessage),
    };
    const provider = await knex(tableNames.providers).where(searchParams).first();
    if (!isRecordDefined(provider)) {
      throw new Error(`Could not find provider with params ${JSON.stringify(searchParams)}`);
    }
    return provider.cumulus_id;
  } catch (error) {
    log.error(error);
    return undefined;
  }
};

module.exports = {
  isPostRDSDeploymentExecution,
  hasNoAsyncOpOrExists,
  hasNoParentExecutionOrExists,
  getMessageCollectionCumulusId,
  getMessageProviderCumulusId,
};
