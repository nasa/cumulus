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
  const payload = JSON.parse(get(event, 'Sns.Message'));
  const priorityInfo = get(payload, 'cumulus_meta.priorityInfo', null);
  const executionName = get(payload, 'cumulus_meta.execution_name');
  const status = get(payload, 'meta.status');

  if (!priorityInfo) {
    log.info(`Execution ${executionName} does not have any priority, skipping`);
    return Promise.resolve();
  }

  const { level, maxExecutions } = priorityInfo;
  const semaphoreKey = `${level}-executions`;

  const semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.semaphoreTable
  );

  debugger;

  if (['failed', 'completed'].includes(status)) {
    debugger;
    return semaphore.down(semaphoreKey, maxExecutions);
  }

  debugger;

  return semaphore.up(semaphoreKey, maxExecutions);
}

/**
 * Lambda function handler for sfPriorityTracker
 *
 * @param  {Object} event - incoming message sns
 * @param  {Object} context - aws lambda context object
 * @param  {function} cb - aws lambda callback function
 * @returns {Promise}
 */
function handler(event, _context, cb) {
  const records = get(event, 'Records');
  if (!records) {
    return cb();
  }

  debugger;

  const jobs = records.map(updatePrioritySemaphore);

  return Promise.all(jobs)
    .then(() => cb(null))
    .catch(cb);
}

module.exports = {
  handler
};