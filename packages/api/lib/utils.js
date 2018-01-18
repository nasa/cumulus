'use strict';

/**
 * A synchronous sleep/wait function
 *
 * @param {number} milliseconds number of milliseconds to sleep
 */
function sleep(milliseconds) {
  const start = new Date().getTime();
  for (let i = 0; i < 1e7; i += 1) {
    if ((new Date().getTime() - start) > milliseconds) {
      break;
    }
  }
}


function errorify(err) {
  return JSON.stringify(err, Object.getOwnPropertyNames(err));
}

module.exports.sleep = sleep;
module.exports.errorify = errorify;
