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

const WorkflowError = createErrorType('WorkflowError');

module.exports = {
  // WorkflowError should be bubbled out to the overall workflow in the 'exception'
  // field, rather than being thrown and causting an immediate failure
  WorkflowError: WorkflowError,

  // NotNeededError indicates that execution was not completed because it was unnecessary.
  // The workflow should therefore terminate but be considered successful
  NotNeededError: createErrorType('NotNeeded', WorkflowError),

  // IncompleteError indicates that the execution was partially successful and can be
  // re-executed to make further progress. This may happen, for instance, if an execution timeout
  // stops progress
  IncompleteError: createErrorType('Incomplete', WorkflowError),

  // ResourcesLockedError indicates that the execution is unable to proceed due to resources
  // being tied up in other executions. Execution may be retried after resources free up
  ResourcesLockedError: createErrorType('ResourcesLockedError', WorkflowError)
};
