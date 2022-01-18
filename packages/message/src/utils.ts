import isNil from 'lodash/isNil';
import isObject from 'lodash/isObject';

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
