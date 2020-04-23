/**
 * Creates a new error type with the given name and parent class. Sets up
 * boilerplate necessary to successfully subclass Error and preserve stack trace
 * @param name - The name of the error type
 * @param parentType - The error that serves as the parent
 * @returns - The new type
 */

export const createErrorType = (
  name: string,
  ParentType: new (message: string) => Error = Error
) =>
  (
    class extends ParentType {
      constructor(message: string) {
        super(message);
        this.name = name;
        Error.captureStackTrace(this, this.constructor);
      }
    }
  );

interface ErrorWithOptionalCode extends Error {
  code?: string;
}

/**
 * Test to see if a given exception is an AWS Throttling Exception
 */
export const isThrottlingException = (err: ErrorWithOptionalCode) => err.code === 'ThrottlingException';

/**
 * Returns true if the error is a resource error.
 */
export const isWorkflowError = (error: Error) => error.name.includes('WorkflowError');

/**
 * Returns true if the error is a DynamoDB conditional check exception.
 */
export const isConditionalCheckException = (error: { code?: string }) =>
  error.code === 'ConditionalCheckFailedException';

// WorkflowError should be bubbled out to the overall workflow in the 'exception'
// field, rather than being thrown and causting an immediate failure
export const WorkflowError = createErrorType('WorkflowError');

// NotNeededError indicates that execution was not completed because it was unnecessary.
// The workflow should therefore terminate but be considered successful
export const NotNeededError = createErrorType('NotNeededWorkflowError', WorkflowError);

// IncompleteError indicates that the execution was partially successful and can be
// re-executed to make further progress. This may happen, for instance, if an execution timeout
// stops progress
export const IncompleteError = createErrorType('IncompleteWorkflowError', WorkflowError);

// ResourcesLockedError indicates that the execution is unable to proceed due to resources
// being tied up in other executions. Execution may be retried after resources free up
export const ResourcesLockedError = createErrorType('ResourcesLockedWorkflowError', WorkflowError);

// RemoteResourceError indicates that a required remote resource could not be fetched or
// otherwise used
export const RemoteResourceError = createErrorType('RemoteResourceError');

// The error object for when the xml file path is not provided
export const XmlMetaFileNotFound = createErrorType('XmlMetaFileNotFound');

// No CMR metadata file was present.
export const CMRMetaFileNotFound = createErrorType('CMRMetaFileNotFound');

// The provider info is missing error
export const ProviderNotFound = createErrorType('ProviderNotFound');

// The FTPError
export const FTPError = createErrorType('FTPError');

// The PDR Parsing Error
export const PDRParsingError = createErrorType('PDRParsingError');

// Connection Timeout
export const ConnectionTimeout = createErrorType('ConnectionTimeout');

export const HostNotFound = createErrorType('HostNotFound');

// to be returned when the file is missing or forbidden
export const FileNotFound = createErrorType('FileNotFound');

// if a checksum doesn't match
export const InvalidChecksum = createErrorType('InvalidChecksum');

export const DuplicateFile = createErrorType('DuplicateFile');

export const UnexpectedFileSize = createErrorType('UnexpectedFileSize');

// Error thrown when system encounters a conflicting request.
export const InvalidArgument = createErrorType('InvalidArgument');

// is raised if the PDR file doesn't match the collection
export const MismatchPdrCollection = createErrorType('MismatchPdrCollection');

// Error class for file locations that are unparsable
export const UnparsableFileLocationError = createErrorType('UnparsableFileLocationError');

// if a record cannot be found
export const RecordDoesNotExist = createErrorType('RecordDoesNotExist');

export const InvalidRegexError = createErrorType('InvalidRegexError');

export const UnmatchedRegexError = createErrorType('UnmatchedRegexError');

export const ValidationError = createErrorType('ValidationError');
