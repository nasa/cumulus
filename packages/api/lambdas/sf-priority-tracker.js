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
 * @returns {Promise} object with response from the three indexer
 */
async function updatePrioritySemaphore(event) {
  const message = JSON.parse(get(event, 'Sns.Message'));
  const priorityInfo = get(message, 'cumulus_meta.priorityInfo', {});
  const executionName = get(message, 'cumulus_meta.execution_name');
  const status = get(message, 'meta.status');

  if (!status) {
    log.error(`Could determine execution status for ${executionName}. Skipping`);
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

  if (['failed', 'completed'].includes(status)) {
    return semaphore.down(key, maxExecutions);
  }

  return semaphore.up(key, maxExecutions);
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