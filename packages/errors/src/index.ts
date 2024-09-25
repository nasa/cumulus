/* eslint-disable max-classes-per-file */

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

/**
 * A constructor function that returns an instance of Error (or something that inherits from Error).
 * Typically, this is going to be a class, such as `Error`, `TypeError`, etc.
 */
type ErrorClass = new (message: string) => Error;

/**
 * Creates a new error type with the given name and parent class. Sets up
 * boilerplate necessary to successfully subclass Error and preserve stack trace
 * @param name - The name of the error type
 * @param ParentType - The error that serves as the parent
 * @returns The new type
 */
export const createErrorType = (
  name: string,
  ParentType: ErrorClass = Error
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

export class ThrottlingException extends Error {
  readonly code: string;

  constructor() {
    super('ThrottlingException');
    this.name = 'ThrottlingException';
    this.code = 'ThrottlingException';
    Error.captureStackTrace(this, this.constructor);
  }
}

export interface ErrorWithOptionalCode extends Error {
  code?: string;
}

/**
 * Test to see if a given exception is a Throttling Exception.
 * Note: ThrottlingException is a Cumulus-defined error, not an AWS-SDK error
 */
export const isThrottlingException = (err: ErrorWithOptionalCode) =>
  err.name === 'ThrottlingException' || err.code === 'ThrottlingException';;

/**
 * Returns true if the error is a resource error.
 */
export const isWorkflowError = (error: Error) => error.name.includes('WorkflowError');

/**
 * Returns true if the error is a DynamoDB conditional check exception.
 */
export const isConditionalCheckException = (error: Error) =>
  error instanceof ConditionalCheckFailedException;

/**
 * WorkflowError should be bubbled out to the overall workflow in the 'exception' field, rather than
 * being thrown and causting an immediate failure
 */
export const WorkflowError = createErrorType('WorkflowError');

/**
 * NotNeededError indicates that execution was not completed because it was unnecessary. The
 * workflow should therefore terminate but be considered successful
 */
export const NotNeededError = createErrorType('NotNeededWorkflowError', WorkflowError);

/**
 * IncompleteError indicates that the execution was partially successful and can be re-executed to
 * make further progress. This may happen, for instance, if an execution timeout stops progress
 */
export const IncompleteError = createErrorType('IncompleteWorkflowError', WorkflowError);

/**
 * ResourcesLockedError indicates that the execution is unable to proceed due to resources being
 * tied up in other executions. Execution may be retried after resources free up
 */
export const ResourcesLockedError = createErrorType('ResourcesLockedWorkflowError', WorkflowError);

/**
 * RemoteResourceError indicates that a required remote resource could not be fetched or otherwise
 * used
 */
export const RemoteResourceError = createErrorType('RemoteResourceError');

/**
 * The error object for when the xml file path is not provided
 */
export const XmlMetaFileNotFound = createErrorType('XmlMetaFileNotFound');

/**
 * No CMR metadata file was present.
 */
export const CMRMetaFileNotFound = createErrorType('CMRMetaFileNotFound');

/**
 * CMR returned an internal server error
 */
export const CMRInternalError = createErrorType('CMRInternalError');

/**
 * Distribution bucket map is missing a configured value for a distribution bucket
 */
export const MissingBucketMap = createErrorType('MissingBucketMap');

/**
 * The provider info is missing error
 */

export const ApiCollisionError = createErrorType('ApiCollisionError');

export const ConnectionTimeout = createErrorType('ConnectionTimeout');

export const CumulusMessageError = createErrorType('CumulusMessageError');

export const DeletePublishedGranule = createErrorType('DeletePublishedGranule');

export const DuplicateFile = createErrorType('DuplicateFile');

export const EcsStartTaskError = createErrorType('EcsStartTaskError');

export const FileNotFound = createErrorType('FileNotFound');

export const FTPError = createErrorType('FTPError');

export const GranuleNotPublished = createErrorType('GranuleNotPublished');

export const GranuleFileWriteError = createErrorType('GranuleFileWriteError');

export const HostNotFound = createErrorType('HostNotFound');

export const InvalidArgument = createErrorType('InvalidArgument');

export const InvalidChecksum = createErrorType('InvalidChecksum');

export const InvalidRegexError = createErrorType('InvalidRegexError');

export const MismatchPdrCollection = createErrorType('MismatchPdrCollection');

export const MissingRequiredArgument = createErrorType('MissingRequiredArgument');

export const MissingRequiredEnvVar = createErrorType('MissingRequiredEnvVar');

export const MissingRequiredEnvVarError = createErrorType('MissingRequiredEnvVarError');

export const PDRParsingError = createErrorType('PDRParsingError');

export const ProviderNotFound = createErrorType('ProviderNotFound');

export const RecordAlreadyMigrated = createErrorType('RecordAlreadyMigrated');

export const RecordDoesNotExist = createErrorType('RecordDoesNotExist');

export const UnexpectedFileSize = createErrorType('UnexpectedFileSize');

export const UnmatchedRegexError = createErrorType('UnmatchedRegexError');

export const UnparsableFileLocationError = createErrorType('UnparsableFileLocationError');

export const ValidationError = createErrorType('ValidationError');

export class PostgresValidationError extends ValidationError {
  detail: string | undefined;
  constructor(message: string) {
    super(message);
    this.name = 'PostgresValidationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export const PostgresUpdateFailed = createErrorType('PostgresUpdateFailed');

export const IndexExistsError = createErrorType('IndexExistsError');

export const UnmetRequirementsError = createErrorType('UnmetRequirementsError');
