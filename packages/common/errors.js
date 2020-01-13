const errors = require('@cumulus/errors');

const { deprecate } = require('./util');

/**
 * Creates a new error type with the given name and parent class. Sets up
 * boilerplate necessary to successfully subclass Error and preserve stack trace
 * @param {string} name - The name of the error type
 * @param {Error} parentType - The error that serves as the parent
 * @return - The new type
 */

const createErrorType = (name, ParentType = Error) => {
  deprecate('@cumulus/common/errors/createErrorType', '1.17.0', '@cumulus/errors/createErrorType');
  return errors.createErrorType(name, ParentType);
};

/**
 * Returns true if the error is a resource error.
 *
 * @param {Error} error
 * @returns {boolean}
 */
const isWorkflowError = (error) => {
  deprecate('@cumulus/common/errors/isWorkflowError', '1.17.0', '@cumulus/errors/isWorkflowError');
  return errors.isWorkflowError(error);
};

/**
 * Returns true if the error is a DynamoDB conditional check exception.
 *
 * @param {Error} error
 * @returns {boolean}
 */
const isConditionalCheckException = (error) => {
  deprecate('@cumulus/common/errors/isConditionalCheckException', '1.17.0', '@cumulus/errors/isConditionalCheckException');
  return errors.isConditionalCheckException(error);
};

module.exports = {
  ...errors,

  createErrorType,

  isConditionalCheckException,
  isWorkflowError
};
