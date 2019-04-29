const get = require('lodash.get');
const {
  concurrency: {
    Semaphore
  },
  aws,
  log
} = require('@cumulus/common');

/**
 * Update semaphore for executions with priority
 *
 * @param  {Object} event - incoming cumulus message
 * @returns {Promise} Result of semaphore update operation
 */
async function updatePrioritySemaphore(event) {
  const message = JSON.parse(get(event, 'Sns.Message'));
  const priorityInfo = get(message, 'cumulus_meta.priorityInfo', {});
  const executionName = get(message, 'cumulus_meta.execution_name');
  const status = get(message, 'meta.status');

  if (!['failed', 'completed'].includes(status)) {
    log.error(`Execution ${executionName} with status ${status} is not a completed/failed state. Skipping`);
    return Promise.resolve();
  }

  const { key, maxExecutions } = priorityInfo;
  if (!key || !maxExecutions) {
    log.info(`Execution ${executionName} does not have any priority. Skipping`);
    return Promise.resolve();
  }

  const semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.semaphoreTable
  );

  return semaphore.down(key, maxExecutions);
}

/**
 * Lambda function handler for sfPriorityTracker
 *
 * @param  {Object} event - incoming message from SNS
 * @param  {Object} context - aws lambda context object
 * @returns {Promise}
 */
async function handler(event, _context) {
  const records = get(event, 'Records');
  if (!records) {
    return cb();
  }

  const jobs = records.map(updatePrioritySemaphore);

  return Promise.all(jobs);
}

module.exports = {
  handler
};