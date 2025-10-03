'use strict';

const get = require('lodash/get');
const isObject = require('lodash/isObject');
const isNil = require('lodash/isNil');
const pick = require('lodash/pick');
const { InvalidRegexError, UnmatchedRegexError } = require('@cumulus/errors');

function replacerFactory() {
  const seen = new WeakSet();

  return function replacer(key, value) {
    if (isObject(value) && value !== null) {
      if (seen.has(value)) {
        return undefined; // Remove circular reference
      }
      seen.add(value);
    }

    // If it's an object but not an array, pick its own property names
    if (!Array.isArray(value) && isObject(value)) {
      return pick(value, Object.getOwnPropertyNames(value));
    }

    return value;
  };
}

function errorify(err) {
  return JSON.stringify(err, replacerFactory());
}

function filenamify(fileName) {
  return fileName.replace(/["%*/:<>?\\|]/g, '_');
}

/**
 * Returns the name and version of a collection based on
 * the collectionId used in elasticsearch indexing
 *
 * @param {string} collectionId - collectionId used in elasticsearch index
 * @returns {Object} name and version as object
 */
function deconstructCollectionId(collectionId) {
  const [name, version] = collectionId.split('___');
  return {
    name,
    version,
  };
}

/**
 * Ensures that the exception is returned as an object
 *
 * @param {*} exception - the exception
 * @returns {Object} an objectified exception
 */
function parseException(exception) {
  if (isNil(exception)) return {};
  if (isObject(exception)) return exception;
  if (exception === 'None') return {};
  return {
    Error: 'Unknown Error',
    Cause: exception,
  };
}

/**
 * Extract a date from the payload and return it in string format
 *
 * @param {Object} payload - payload object
 * @param {string} dateField - date field to extract
 * @returns {string} - date field in string format, null if the
 * field does not exist in the payload
 */
function extractDate(payload, dateField) {
  const dateMs = get(payload, dateField);

  if (dateMs) {
    const date = new Date(dateMs);
    return date.toISOString();
  }

  return undefined;
}

/**
 * Find a property name in an object in a case-insensitive manner
 *
 * @param {Object} obj - the object to be searched
 * @param {string} keyArg - the name of the key to find
 * @returns {string|undefined} - the name of the matching key, or undefined if
 *   none was found
 */
function findCaseInsensitiveKey(obj, keyArg) {
  const keys = Object.keys(obj);
  return keys.find((key) => key.toLowerCase() === keyArg.toLowerCase());
}

/**
 * Find a property value in an object in a case-insensitive manner
 *
 * @param {Object} obj - the object to be searched
 * @param {string} keyArg - the name of the key to find
 * @returns {*} the matching value
 */
function findCaseInsensitiveValue(obj, keyArg) {
  return obj[findCaseInsensitiveKey(obj, keyArg)];
}

/**
 * Test a regular expression against a sample filename.
 *
 * @param {string} regex - a regular expression
 * @param {string} sampleFileName - the same filename to test the regular expression
 * @param {string} regexFieldName - Name of the field name for the regular expression, if any
 * @throws {InvalidRegexError|UnmatchedRegexError}
 * @returns {Array<string>} - Array of matches from applying the regex to the sample filename.
 *  See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match.
 */

function checkRegex(regex, sampleFileName, regexFieldName = 'regex') {
  let matchingRegex;
  try {
    matchingRegex = new RegExp(regex);
  } catch (error) {
    throw new InvalidRegexError(`Invalid ${regexFieldName}: ${error.message}`);
  }

  const match = sampleFileName.match(matchingRegex);
  if (!match) {
    throw new UnmatchedRegexError(`${regexFieldName} "${regex}" cannot validate "${sampleFileName}"`);
  }

  return match;
}

/**
 * Sets environment variables for the operation with overrides from a lambda event
 * Used in bulk operation lambdas for EC2/Fargate execution
 *
 * @param {Object.<string, string>} event.envVars - The environment variables to set.
 * If not provided, defaults to an empty object.
 * @param {...any} event
 */
const setEnvVarsForOperation = (event) => {
  const envVars = get(event, 'envVars', {});
  Object.keys(envVars).forEach((envVarKey) => {
    if (!process.env[envVarKey]) {
      process.env[envVarKey] = envVars[envVarKey];
    }
  });
};

const validateCollectionCoreConfig = (collection) => {
  // Test that granuleIdExtraction regex matches against sampleFileName
  const match = checkRegex(collection.granuleIdExtraction, collection.sampleFileName, 'granuleIdExtraction');

  if (!match[1]) {
    throw new UnmatchedRegexError(
      `granuleIdExtraction regex "${collection.granuleIdExtraction}" does not return a matched group when applied to sampleFileName "${collection.sampleFileName}". `
      + 'Ensure that your regex includes capturing groups.'
    );
  }

  // Test that granuleId regex matches the what was extracted from the
  // sampleFileName using the granuleIdExtraction
  checkRegex(collection.granuleId, match[1], 'granuleId');
};

const validateCollectionFilesConfig = (collection) => {
  // Check that each file.regex matches against file.sampleFileName
  collection.files.forEach((file) => checkRegex(file.regex, file.sampleFileName));

  // Check that any files with a `checksumFor` field match one of the other files;
  collection.files.forEach((fileConfig) => {
    const checksumFor = fileConfig.checksumFor;
    if (!checksumFor) return;
    const matchingFiles = collection.files.filter((f) => f.regex === checksumFor);
    if (matchingFiles.length === 0) {
      throw new UnmatchedRegexError(`checksumFor '${checksumFor}' does not match any file regex`);
    }
    if (matchingFiles.length > 1) {
      throw new InvalidRegexError(`checksumFor '${checksumFor}' matches multiple file regexes`);
    }
    if (matchingFiles[0] === fileConfig) {
      throw new InvalidRegexError(`checksumFor '${checksumFor}' cannot be used to validate itself`);
    }
  });
};

const validateCollection = (collection) => {
  validateCollectionCoreConfig(collection);
  validateCollectionFilesConfig(collection);
};

module.exports = {
  deconstructCollectionId,
  parseException,
  errorify,
  extractDate,
  filenamify,
  findCaseInsensitiveKey,
  findCaseInsensitiveValue,
  setEnvVarsForOperation,
  validateCollection,
};
