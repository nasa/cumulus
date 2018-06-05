'use strict';

/**
 * A migration must implement a run function. The run functions of all migrations
 * imported to the index class are executed in sequence. The run function must
 * return a promise
 *
 * @returns {Promise<string>} test message
 */
async function run() {
  console.log('this is an example migration');
  return 'test_migration';
}

module.exports.run = run;
