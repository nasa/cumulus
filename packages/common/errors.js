const isFunction = require('lodash.isfunction');

/**
 * Creates a new error type with the given name and parent class. Sets up
 * boilerplate necessary to successfully subclass Error and preserve stack trace
 * @param {string} name - The name of the error type
 * @param {Error} parentType - The error that serves as the parent
 * @return - The new type
 */

const createErrorType = (name, ParentType = Error) => {
  function E(message) {
    if (isFunction(Error.captureStackTrace)) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error(message)).stack;
    }
    this.message = message;
  }
  E.prototype = new ParentType();
  E.prototype.name = name;
  E.prototype.constructor = E;
  return E;
};

const WorkflowError = createErrorType('WorkflowError');

/**
 * Returns true if the error is a resource error.
 *
 * @param {Error} error
 * @returns {boolean}
 */
const isWorkflowError = (error) => error.name.includes('WorkflowError');

/**
 * Returns true if the error is a DynamoDB conditional check exception.
 *
 * @param {Error} error
 * @returns {boolean}
 */
const isConditionalCheckException = (error) => error.code === 'ConditionalCheckFailedException';

module.exports = {

  createErrorType: createErrorType,

  isConditionalCheckException,
  isWorkflowError,

  // WorkflowError should be bubbled out to the overall workflow in the 'exception'
  // field, rather than being thrown and causting an immediate failure
  WorkflowError: WorkflowError,

  // NotNeededError indicates that execution was not completed because it was unnecessary.
  // The workflow should therefore terminate but be considered successful
  NotNeededError: createErrorType('NotNeededWorkflowError', WorkflowError),

  // IncompleteError indicates that the execution was partially successful and can be
  // re-executed to make further progress. This may happen, for instance, if an execution timeout
  // stops progress
  IncompleteError: createErrorType('IncompleteWorkflowError', WorkflowError),

  // ResourcesLockedError indicates that the execution is unable to proceed due to resources
  // being tied up in other executions. Execution may be retried after resources free up
  ResourcesLockedError: createErrorType('ResourcesLockedWorkflowError', WorkflowError),

  // RemoteResourceError indicates that a required remote resource could not be fetched or
  // otherwise used
  RemoteResourceError: createErrorType('RemoteResourceError'),

  // The error object for when the xml file path is not provided
  XmlMetaFileNotFound: createErrorType('XmlMetaFileNotFound'),

  // No CMR metadata file was present.
  CMRMetaFileNotFound: createErrorType('CMRMetaFileNotFound'),

  // The provider info is missing error
  ProviderNotFound: createErrorType('ProviderNotFound'),

  // The FTPError
  FTPError: createErrorType('FTPError'),

  // The PDR Parsing Error
  PDRParsingError: createErrorType('PDRParsingError'),

  // Connection Timeout
  ConnectionTimeout: createErrorType('ConnectionTimeout'),

  HostNotFound: createErrorType('HostNotFound'),

  // to be returned when the file is missing or forbidden
  FileNotFound: createErrorType('FileNotFound'),

  // if a checksum doesn't match
  InvalidChecksum: createErrorType('InvalidChecksum'),

  DuplicateFile: createErrorType('DuplicateFile'),

  UnexpectedFileSize: createErrorType('UnexpectedFileSize'),

  // Error thrown when system encounters a conflicting request.
  InvalidArgument: createErrorType('InvalidArgument'),

  // is raised if the PDR file doesn't match the collection
  MismatchPdrCollection: createErrorType('MismatchPdrCollection'),

  // Error class for file locations that are unparsable
  UnparsableFileLocationError: createErrorType('UnparsableFileLocationError'),

  // if a record cannot be found
  RecordDoesNotExist: createErrorType('RecordDoesNotExist')
};
