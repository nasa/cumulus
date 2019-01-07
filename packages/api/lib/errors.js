'use strict';

/**
 * Creates a new error type with the given name and parent class. Sets up
 * boilerplate necessary to successfully subclass Error and preserve stack trace
 * @param {string} name - The name of the error type
 * @param {Error} parentType - The error that serves as the parent
 * @return - The new type
 */

const createErrorType = (name, ParentType = Error) => {
  function E(message) {
    Error.captureStackTrace(this, this.constructor);
    this.message = message;
  }
  E.prototype = new ParentType();
  E.prototype.name = name;
  E.prototype.constructor = E;
  return E;
};

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
