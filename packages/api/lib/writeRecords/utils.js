const isNil = require('lodash/isNil');
const semver = require('semver');

const { envUtils } = require('@cumulus/common');
const {
  AsyncOperationPgModel,
  CollectionPgModel,
  ExecutionPgModel,
  ProviderPgModel,
  GranulePgModel,
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
const { deconstructCollectionId } = require('../utils');

const log = new Logger({ sender: '@cumulus/api/lib/writeRecords/utils' });

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

const getAsyncOperationCumulusId = async (
  asyncOperationId,
  knex,
  asyncOperationPgModel = new AsyncOperationPgModel()
) => {
  try {
    if (isNil(asyncOperationId)) {
      throw new InvalidArgument('There is no async operation ID to lookup on the message, skipping');
    }
    return await asyncOperationPgModel.getRecordCumulusId(
      knex,
      {
        id: asyncOperationId,
      }
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      log.info(error);
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
      throw new InvalidArgument('There is no parent execution ARN to lookup on the message, skipping');
    }
    return await executionPgModel.getRecordCumulusId(
      knex,
      {
        arn: parentExecutionArn,
      }
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      log.info(error);
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
      throw new InvalidArgument('There is no collection name/version on the message to lookup, skipping');
    }
    return await collectionPgModel.getRecordCumulusId(
      knex,
      collectionNameVersion
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      log.info(error);
      return undefined;
    }
    throw error;
  }
};

const getGranuleCumulusId = async (
  granuleId,
  collectionId,
  knex,
  collectionPgModel = new CollectionPgModel(),
  granulePgModel = new GranulePgModel()
) => {
  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knex,
      deconstructCollectionId(collectionId)
    );

    return await granulePgModel.getRecordCumulusId(
      knex,
      {
        granule_id: granuleId,
        collection_cumulus_id: collectionCumulusId,
      }
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      log.info(error);
      return undefined;
    }
    throw error;
  }
};

/**
 * Looks up an Provider's cumulus_id by providerId.
 *
 * @param {string} [providerId = ''] - Full url of stepfunction execution
 * @param {Knex} knex - knex Client
 * @param {Object} providerPgModel - Instance of the provider database model
 * @returns {integer} - RDS internal cumulus_id
 */
const getProviderCumulusId = async (
  providerId,
  knex,
  providerPgModel = new ProviderPgModel()
) => await providerPgModel.getRecordCumulusId(
  knex,
  { name: providerId }
);

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
    return await getProviderCumulusId(providerId, knex, providerPgModel);
  } catch (error) {
    if (isFailedLookupError(error)) {
      log.info(error);
      return undefined;
    }
    throw error;
  }
};

/**
 * Looks up an Execution's cumulus_id by executionUrl.
 *
 * @param {string} [executionUrl = ''] - Full url of stepfunction execution
 * @param {Knex} knex - knex Client
 * @param {Object} executionPgModel - instance of the exection database model
 * @returns {integer|undefined} - RDS internal cumulus_id
 */
const getExecutionCumulusId = async (
  executionUrl = '',
  knex,
  executionPgModel = new ExecutionPgModel()
) => {
  try {
    return await executionPgModel.getRecordCumulusId(
      knex,
      { url: executionUrl }
    );
  } catch (error) {
    if (isFailedLookupError(error)) {
      log.info(error);
      return undefined;
    }
    log.error(`Encountered error trying to find ${executionUrl}`, error);
    throw (error);
  }
};

module.exports = {
  isPostRDSDeploymentExecution,
  getAsyncOperationCumulusId,
  getExecutionCumulusId,
  getGranuleCumulusId,
  getParentExecutionCumulusId,
  getProviderCumulusId,
  getCollectionCumulusId,
  getMessageProviderCumulusId,
};
