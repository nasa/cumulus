'use strict';

/* eslint-disable no-console */

/**
 * Verify that the given param is not null. Write out an error if null.
 *
 * @param {Object} paramConfig - param name and value {name: value:}
 * @returns {boolean} true if param is not null
 */
function verifyRequiredParameter(paramConfig) {
  if (paramConfig.value === null) {
    console.log(`Error: ${paramConfig.name} is a required parameter.`);
    return false;
  }

  return true;
}

/**
 * Verify required parameters are present
 *
 * @param {list<Object>} requiredParams - params in the form {name: 'x' value: 'y'}
 * @returns {boolean} - true if all params are not null
 */
function verifyRequiredParameters(requiredParams) {
  return requiredParams.map(verifyRequiredParameter).includes(false) === false;
}

module.exports.verifyRequiredParameters = verifyRequiredParameters;
