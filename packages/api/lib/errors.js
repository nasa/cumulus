'use strict';

const { createErrorType } = require('@cumulus/common/errors');

module.exports.RecordDoesNotExist = createErrorType('RecordDoesNotExist');
module.exports.TokenUnauthorizedUserError = createErrorType('TokenUnauthorizedUserError');

class AssociatedRulesError extends Error {
  constructor(message, rules = []) {
    super(message);
    this.rules = rules;
    this.name = this.constructor.name;
  }
}
exports.AssociatedRulesError = AssociatedRulesError;
