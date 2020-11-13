/* eslint-disable max-classes-per-file */

'use strict';

const {
  createErrorType,
  ValidationError,
} = require('@cumulus/errors');

// Postgres error codes:
// https://www.postgresql.org/docs/10/errcodes-appendix.html
const isPostgresValidationError = (error) => ['22', '23'].includes((error.code || '').substring(0, 2));

const isBadRequestError = (error) =>
  error.name === 'SchemaValidationError'
  || error instanceof ValidationError
  || isPostgresValidationError(error);

const TokenUnauthorizedUserError = createErrorType('TokenUnauthorizedUserError');
const IndexExistsError = createErrorType('IndexExistsError');

class AssociatedRulesError extends Error {
  constructor(message, rules = []) {
    super(message);
    this.rules = rules;
    this.name = this.constructor.name;
  }
}

class ApiCollisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CumulusMessageError';
    Error.captureStackTrace(this, ApiCollisionError);
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

module.exports = {
  ApiCollisionError,
  AssociatedRulesError,
  IndexExistsError,
  TokenUnauthorizedUserError,
  EarthdataLoginError,
  isBadRequestError,
};
