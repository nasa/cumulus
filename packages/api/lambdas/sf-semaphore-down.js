const get = require('lodash.get');
const {
  concurrency: {
    Semaphore
  },
  aws,
  log
} = require('@cumulus/common');

/**
 * Decrement semaphore value for executions with priority
 *
 * @param  {Object} event - incoming cumulus message
 * @returns {Promise} A promise indicating function completion
 * @throws {Error} Error from semaphore.down() operation
 */
async function decrementPrioritySemaphore(event) {
  const message = JSON.parse(get(event, 'Sns.Message'));
  const priorityInfo = get(message, 'cumulus_meta.priorityInfo', {});
  const executionName = get(message, 'cumulus_meta.execution_name');
  const status = get(message, 'meta.status');

  if (!['failed', 'completed'].includes(status)) {
    log.error(`Execution ${executionName} with status ${status} is not a completed/failed state. Skipping`);
    return Promise.resolve();
  }

  const { key } = priorityInfo;
  if (!key) {
    log.info(`Execution ${executionName} does not have any priority. Skipping`);
    return Promise.resolve();
  }

  const semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.SemaphoresTable
  );

  // Error should only be thrown if we are attempting to decrement the 
  // count below 0. If so, catch the error so it can be logged.
  try {
    await semaphore.down(key);
  } catch (err) {
    log.error(`Attempted to decrement semaphore for key ${key} below 0`);
    throw err;
  }
}

/**
 * Lambda function handler for sfSemaphoreDown
 *
 * @param  {Object} event - incoming message from SNS
 * @param  {Object} context - aws lambda context object
 * @returns {Promise}
 */
async function handler(event) {
  const records = get(event, 'Records');
  if (!records) {
    return;
  }

  const jobs = records.map(decrementPrioritySemaphore);

  return Promise.all(jobs);
}

module.exports = handler;
