'use strict';

const get = require('lodash/get');

/**
 * Returns the environment specific identifier for the input cmr environment.
 * @param {string} env - cmr environment ['OPS', 'SIT', 'UAT']
 * @returns {string} - value to use to build correct cmr url for environment.
 */
function hostId(env) {
  return get(
    { OPS: '', SIT: 'sit', UAT: 'uat' },
    env,
    'sit'
  );
}

module.exports = hostId;
