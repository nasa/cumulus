const get = require('lodash.get');

/**
 * Determine if event is an SNS event
 *
 * @param {Object} event - A Cloudwatch event object
 * @returns {boolean} - True if event is an SNS event
 */
const isSnsEvent = (event) => event.EventSource === 'aws.sns';

/**
 * Get message from SNS record.
 *
 * @param {Object} record - Record from SNS event
 * @returns {Object} - Message object from SNS record
 */
const getSnsMessage = (record) => JSON.parse(get(record, 'Sns.Message', '{}'));

module.exports = {
  isSnsEvent,
  getSnsMessage
};
