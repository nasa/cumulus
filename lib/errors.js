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

// WorkflowErrors are errors that are bubbled out to the overall workflow in the 'exception'
// field, rather than being thrown and causting an immediate failure
const WorkflowError = createErrorType('WorkflowError');

module.exports = {
  WorkflowError: WorkflowError,
  NotNeededError: createErrorType('NotNeeded', WorkflowError),
  IncompleteError: createErrorType('Incomplete', WorkflowError),
  ResourcesLockedError: createErrorType('ResourcesLockedError', WorkflowError)
};
