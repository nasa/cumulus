/* eslint-disable max-classes-per-file */

'use strict';

const {
  createErrorType,
  ValidationError,
} = require('@cumulus/errors');

const isBadRequestError = (err) =>
  err.name === 'SchemaValidationError' || err instanceof ValidationError;

const isResourceNotFoundException = (error) =>
  error.code === 'ResourceNotFoundException';

const TokenUnauthorizedUserError = createErrorType('TokenUnauthorizedUserError');
const IndexExistsError = createErrorType('IndexExistsError');

class AssociatedRulesError extends Error {
  constructor(message, rules = []) {
    super(message);
    this.rules = rules;
    this.name = this.constructor.name;
  }
}

class EarthdataLoginError extends Error {
  constructor(code, message) {
    super(message);

    this.name = 'EarthdataLoginError';
    this.code = code;

    Error.captureStackTrace(this, EarthdataLoginError);
  }
}

class ResourceNotFoundError extends Error {
  constructor(error) {
    super(`${error.message} Check if trigger was deleted from lambda.`);

    this.name = 'ResourceNotFoundError';
    this.code = error.code;

    Error.captureStackTrace(this, ResourceNotFoundError);
  }
}

module.exports = {
  AssociatedRulesError,
  IndexExistsError,
  TokenUnauthorizedUserError,
  EarthdataLoginError,
  isBadRequestError,
  isResourceNotFoundException,
  ResourceNotFoundError,
};
