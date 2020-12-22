const isNil = require('lodash/isNil');
const semver = require('semver');

const { envUtils } = require('@cumulus/common');
const {
  tableNames,
  getRecordCumulusId,
  CollectionPgModel,
  ExecutionPgModel,
  ProviderPgModel,
} = require('@cumulus/db');
const {
  MissingRequiredEnvVarError,
  RecordDoesNotExist,
  InvalidArgument,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const {
  getMessageCumulusVersion,
} = require('@cumulus/message/Executions');
const {
  getMessageProviderId,
} = require('@cumulus/message/Providers');

const logger = new Logger({ sender: '@cumulus/api/sfEventSqsToDbRecords/utils' });

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

const isFailedLookupError = (error) =>
  error instanceof InvalidArgument
  || error instanceof RecordDoesNotExist;

const getAsyncOperationCumulusId = async (asyncOperationId, knex) => {
  try {
    if (isNil(asyncOperationId)) {
      throw new InvalidArgument(`Async operation ID is required for lookup, received ${asyncOperationId}`);
    }
    return await getRecordCumulusId(
      {
        id: asyncOperationId,
      },
      tableNames.asyncOperations,
      knex
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      logger.info(error);
      return undefined;
    }
    throw error;
  }
};

const getParentExecutionCumulusId = async (
  parentExecutionArn,
  knex,
  executionPgModel = new ExecutionPgModel()
) => {
  try {
    if (isNil(parentExecutionArn)) {
      throw new InvalidArgument(`Parent execution ARN is required for lookup, received ${parentExecutionArn}`);
    }
    return await executionPgModel.getRecordCumulusId(
      knex,
      {
        arn: parentExecutionArn,
      }
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      logger.info(error);
      return undefined;
    }
    throw error;
  }
};

const getCollectionCumulusId = async (
  collectionNameVersion,
  knex,
  collectionPgModel = new CollectionPgModel()
) => {
  try {
    if (isNil(collectionNameVersion)) {
      throw new InvalidArgument(`Collection name/version is required for lookup, received ${collectionNameVersion}`);
    }
    return await collectionPgModel.getRecordCumulusId(
      knex,
      collectionNameVersion
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      logger.info(error);
      return undefined;
    }
    throw error;
  }
};

const getMessageProviderCumulusId = async (
  cumulusMessage,
  knex,
  providerPgModel = new ProviderPgModel()
) => {
  try {
    const providerId = getMessageProviderId(cumulusMessage);
    if (isNil(providerId)) {
      throw new InvalidArgument('Could not find provider ID in message');
    }
    return await providerPgModel.getRecordCumulusId(
      knex,
      {
        name: getMessageProviderId(cumulusMessage),
      }
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      logger.info(error);
      return undefined;
    }
    throw error;
  }
};

module.exports = {
  isPostRDSDeploymentExecution,
  getAsyncOperationCumulusId,
  getParentExecutionCumulusId,
  getCollectionCumulusId,
  getMessageProviderCumulusId,
};
