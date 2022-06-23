import isNil from 'lodash/isNil';
import isObject from 'lodash/isObject';
import { ApiFile } from '@cumulus/types/api/files';

/**
 * Check if the file has the extension
 *
 * @param {ApiFile} granuleFile     - Granule file
 * @param {string} extension        - File extension to check
 * @returns {boolean} whether the file has the extension
 */
export const isFileExtensionMatched = (granuleFile: ApiFile, extension: string) => {
  const fileName = granuleFile.key || granuleFile.name || granuleFile.filename || '';
  return fileName.endsWith(extension);
};

/**
 * Ensures that the exception is returned as an object
 *
 * @param {Object|undefined} exception - the exception
 * @returns {string} an stringified exception
 */
export const parseException = (exception: Object | undefined) => {
  if (isNil(exception)) return {};
  if (isObject(exception)) return exception;
  return {
    Error: 'Unknown Error',
    Cause: exception,
  };
};
