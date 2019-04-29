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
 * @returns {Promise} Result of semaphore update operation
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

  return semaphore.down(key);
}

/**
 * Lambda function handler for sfPriorityTracker
 *
 * @param  {Object} event - incoming message from SNS
 * @param  {Object} context - aws lambda context object
 * @returns {Promise}
 */
async function handler(event) {
  const records = get(event, 'Records');
  if (!records) {
    return cb();
  }

  const jobs = records.map(decrementPrioritySemaphore);

  return Promise.all(jobs);
}

module.exports = {
  handler
};