'use strict';

/**
 * Wait for the defined number of milliseconds
 *
 * @param {number} waitPeriodMs - number of milliseconds to wait
 * @returns {Promise.<undefined>} - promise resolves after a given time period
 */
function sleep(waitPeriodMs) {
  return new Promise((resolve) => setTimeout(resolve, waitPeriodMs));
}

module.exports = sleep;
