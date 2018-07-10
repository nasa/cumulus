'use strict';

/**
 * A migration must implement a run function. The run functions of all migrations
 * imported to the index class are executed in sequence. The run function must
 * return a promise
 *
 * @param {Object} options - options passed from the main runner
 * @returns {Promise<string>} test message
 */
async function run(options) {
  console.log('this is an example migration');
  return options;
}

module.exports.name = 'migration_0';
module.exports.run = run;
