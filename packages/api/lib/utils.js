'use strict';

const get = require('lodash/get');
const isObject = require('lodash/isObject');
const isNil = require('lodash/isNil');
const { getMetaStatus } = require('@cumulus/message/workflows');
const { getMessageExecutionArn } = require('@cumulus/message/Executions');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const Logger = require('@cumulus/logger');
const { failedStepName, lastExecutionFailure } = require('./cwSfExecutionEventUtils');

const log = new Logger('@cumulus/api/lib/utils');

function errorify(err) {
  return JSON.stringify(err, Object.getOwnPropertyNames(err));
}

function filenamify(fileName) {
  return fileName.replace(/["%*/:<>?\\|]/g, '_');
}

/**
 * Ensures that the exception is returned as an object
 *
 * @param {*} exception - the exception
 * @returns {Object} an objectified exception
 */
function parseException(exception) {
  if (isNil(exception)) return {};
  if (isObject(exception)) return exception;
  if (exception === 'None') return {};
  return {
    Error: 'Unknown Error',
    Cause: exception,
  };
}

/**
 * For any status Failed cumulusMessage, update the message with the
 * Execution's failed step name in `FailedExecutionStepName` and update the
 * `FailedExecutionStepOutput` with the last failed output from either a
 * LambdaFunctionFailed, or ActivityFailed step and add those new properties to
 * the error record (leaving anything that was parsed from the cumulusMessage.exception?)
 * @param {Object} cumulusMessage
 */
const amendCumulusMessageError = async (cumulusMessage) => {
  const amendedMessage = { ...cumulusMessage };
  amendedMessage.error = parseException(cumulusMessage.exception);

  const status = getMetaStatus(cumulusMessage);
  if (status !== 'failed') {
    return amendedMessage;
  }

  try {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    const { events } = await StepFunctions.getExecutionHistory(executionArn);
    const lastFailure = lastExecutionFailure(events);
    const failedExecutionStepOutput = {
      ...lastFailure.lambdaFunctionFailedEventDetails,
      ...lastFailure.activityFailedEventDetails,
    };
    const failedExecutionStepName = failedStepName(events, lastFailure);
    amendedMessage.error = {
      ...amendedMessage.error,
      failedExecutionStepName,
      failedExecutionStepOutput,
    };
  } catch (error) {
    log.error(error);
  }
  return amendedMessage;
};

/**
 * Returns the name and version of a collection based on
 * the collectionId used in elasticsearch indexing
 *
 * @param {string} collectionId - collectionId used in elasticsearch index
 * @returns {Object} name and version as object
 */
function deconstructCollectionId(collectionId) {
  const [name, version] = collectionId.split('___');
  return {
    name,
    version,
  };
}

/**
 * Extract a date from the payload and return it in string format
 *
 * @param {Object} payload - payload object
 * @param {string} dateField - date field to extract
 * @returns {string} - date field in string format, null if the
 * field does not exist in the payload
 */
function extractDate(payload, dateField) {
  const dateMs = get(payload, dateField);

  if (dateMs) {
    const date = new Date(dateMs);
    return date.toISOString();
  }

  return undefined;
}

/**
 * Find a property name in an object in a case-insensitive manner
 *
 * @param {Object} obj - the object to be searched
 * @param {string} keyArg - the name of the key to find
 * @returns {string|undefined} - the name of the matching key, or undefined if
 *   none was found
 */
function findCaseInsensitiveKey(obj, keyArg) {
  const keys = Object.keys(obj);
  return keys.find((key) => key.toLowerCase() === keyArg.toLowerCase());
}

/**
 * Find a property value in an object in a case-insensitive manner
 *
 * @param {Object} obj - the object to be searched
 * @param {string} keyArg - the name of the key to find
 * @returns {*} the matching value
 */
function findCaseInsensitiveValue(obj, keyArg) {
  return obj[findCaseInsensitiveKey(obj, keyArg)];
}

module.exports = {
  amendCumulusMessageError,
  deconstructCollectionId,
  errorify,
  extractDate,
  filenamify,
  findCaseInsensitiveKey,
  findCaseInsensitiveValue,
  parseException,
};
