const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { ResourcesLockedError } = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const Semaphore = require('@cumulus/common/Semaphore');

/**
 * Increment the semaphore for executions started from a queue.
 *
 * Throws `ResourcesLockedError` if maximum number of executions are already
 * running.
 *
 * @param {string} queueName - Queue name which is used as the semaphore key
 * @param {number} maximum - Maximum number of executions allowed for this semaphore
 * @returns {Promise}
 * @throws {Error}
 */
async function incrementQueueSemaphore(queueName, maximum) {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.SemaphoresTable
  );

  try {
    await semaphore.up(queueName, maximum);
    log.info(`incremented queue semaphore for queue ${queueName}`);
  } catch (err) {
    if (err instanceof ResourcesLockedError) {
      log.info(`Unable to start new execution: the maximum number of executions (${maximum}) allowed for ${queueName} are already running.`);
    }
    throw err;
  }
}

/**
 * Decrement semaphore value for executions started from a queue
 *
 * @param {string} queueName - Queue name used as key for semaphore tracking
 *   running executions
 * @returns {Promise} A promise indicating function completion
 * @throws {Error} Error from semaphore.down() operation
 */
async function decrementQueueSemaphore(queueName) {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.SemaphoresTable
  );

  // Error should only be thrown if we are attempting to decrement the
  // count below 0. If so, catch the error so it can be logged.
  try {
    await semaphore.down(queueName);
    log.info(`decremented queue semaphore for queue ${queueName}`);
  } catch (err) {
    log.error(`Failure: attempted to decrement semaphore for queue ${queueName} below 0`);
    throw err;
  }
}

module.exports = {
  decrementQueueSemaphore,
  incrementQueueSemaphore
};
