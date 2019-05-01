const get = require('lodash.get');
const has = require('lodash.has');
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
 * @param {string} key - Key for a semaphore tracking running executions
 * @returns {Promise} A promise indicating function completion
 * @throws {Error} Error from semaphore.down() operation
 */
async function decrementPrioritySemaphore(key) {
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
 * @param {Object} event - incoming message from SNS
 * @returns {Promise}
 */
async function handler(event) {
  const records = get(event, 'Records', []);

  const jobs = records.reduce((jobsArray, record) => {
    // Skip if this record is not from SNS.
    if (!has(record, 'Sns.Message')) {
      return jobsArray;
    }

    // Skip if:
    //   - Message has no priority level
    //   - Message has no workflow status
    //   - Workflow status is not failed/completed
    const workflowMessage = JSON.parse(record.Sns.Message);
    const priorityKey = get(workflowMessage, 'cumulus_meta.priorityInfo.key');
    const status = get(workflowMessage, 'meta.status');
    if (
      !priorityKey ||
      !['failed', 'completed'].includes(status)
    ) {
      return jobsArray;
    }

    jobsArray.push(
      decrementPrioritySemaphore(priorityKey)
    );

    return jobsArray;
  }, [])

  return Promise.all(jobs);
}

module.exports = handler;
