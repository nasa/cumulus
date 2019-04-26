const get = require('lodash.get');
const Semaphore = require('@cumulus/common/Semaphore');
const aws = require('@cumulus/common/aws');

/**
 * Update semaphore for executions with priority
 *
 * @param  {Object} event - incoming cumulus message
 * @returns {Promise} object with response from the three indexer
 */
async function updatePrioritySemaphore(event) {
  const payload = JSON.parse(get(event, 'Sns.Message'));
  const priorityInfo = get(payload, 'throttle_executions', null);

  if (!priorityInfo) {
    return Promise.resolve();
  }

  const { priorityLevel, maxExecutions } = priorityInfo;
  const semaphoreKey = `${priorityLevel}-executions`;

  const semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.semaphoreTable
  );

  if (['failed', 'completed'].includes(payload.meta.status)) {
    semaphore.down(semaphoreKey, maxExecutions);
  } else {
    semaphore.up(semaphoreKey, maxExecutions);
  }

  return;
}

/**
 * Lambda function handler for sfPriorityTracker
 *
 * @param  {Object} event - incoming message sns
 * @param  {Object} context - aws lambda context object
 * @param  {function} cb - aws lambda callback function
 * @returns {Promise} undefined
 */
function handler(event, context, cb) {
  log.debug(JSON.stringify(event));
  const records = get(event, 'Records');
  let jobs = [];

  if (records) {
    jobs = records.map(updatePrioritySemaphore);
  }

  return Promise.all(jobs)
    .then(() => cb(null))
    .catch(cb);
}

module.exports = {
  handler
};