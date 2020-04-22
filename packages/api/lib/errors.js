'use strict';

const {
  createErrorType,
  ValidationError
} = require('@cumulus/errors');

const isBadRequestError = (err) =>
  err.name === 'SchemaValidationError'
  || err instanceof ValidationError;

const TokenUnauthorizedUserError = createErrorType('TokenUnauthorizedUserError');
const IndexExistsError = createErrorType('IndexExistsError');

class AssociatedRulesError extends Error {
  constructor(message, rules = []) {
    super(message);
    this.rules = rules;
    this.name = this.constructor.name;
  }
}

module.exports = {
  AssociatedRulesError,
  IndexExistsError,
  TokenUnauthorizedUserError,
  isBadRequestError
};
