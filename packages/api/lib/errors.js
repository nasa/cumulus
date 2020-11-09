/* eslint-disable max-classes-per-file */

'use strict';
const {
  createErrorType,
  ValidationError,
  RDSValidationError,
} = require('@cumulus/errors');

const isBadRequestError = (err) =>
  err.name === 'SchemaValidationError'
  || err instanceof ValidationError
  || (Number(err.code) >= 22000 && Number(err.code) < 25000);
  // Postgres error codes:
  // https://www.postgresql.org/docs/9.2/errcodes-appendix.html

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

module.exports = {
  AssociatedRulesError,
  IndexExistsError,
  TokenUnauthorizedUserError,
  EarthdataLoginError,
  isBadRequestError,
};
