/* eslint-disable max-classes-per-file */

'use strict';

const {
  createErrorType,
  ValidationError,
} = require('@cumulus/errors');

// Postgres error codes:
// https://www.postgresql.org/docs/10/errcodes-appendix.html
const isPostgresValidationError = (error) => ['22', '23'].includes((error.code || '').substring(0, 2));

const isDynamoValidationException = (error) => error.name === 'ValidationException';

const isBadRequestError = (error) =>
  error.name === 'SchemaValidationError'
  || error.name === 'ValidationException'
  || error instanceof ValidationError
  || isPostgresValidationError(error)
  || isDynamoValidationException(error);

const isResourceNotFoundException = (error) =>
  [error.code, error.name].includes('ResourceNotFoundException');

const TokenUnauthorizedUserError = createErrorType('TokenUnauthorizedUserError');

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

const resourceNotFoundInfo = 'One solution may be to check if topic subscription and/or lambda trigger have been manually deleted from AWS. If so, rule may need to be manually disabled/deleted.';

class ResourceNotFoundError extends Error {
  constructor(error) {
    super(`${error.message} ${resourceNotFoundInfo}`);

    this.name = 'ResourceNotFoundError';
    this.code = error.code;

    Error.captureStackTrace(this, ResourceNotFoundError);
  }
}

module.exports = {
  AssociatedRulesError,
  TokenUnauthorizedUserError,
  EarthdataLoginError,
  isBadRequestError,
  isResourceNotFoundException,
  ResourceNotFoundError,
  resourceNotFoundInfo,
};
