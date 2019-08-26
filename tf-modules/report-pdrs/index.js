'use strict';

const get = require('lodash.get');

const {
  isSnsEvent,
  getSnsEventMessageObject
} = require('@cumulus/common/sns-event');
const Granule = require('@cumulus/api/models/granules');

/**
 * Process Cumulus message object and create granule database records.
 *
 * @param {Object} message - SNS Cumulus message object
 * @returns {Promise<Array>} granule records
 */
async function handleGranuleMessage(message) {
  const granuleModel = new Granule();
  return granuleModel.createGranulesFromSns(message);
}

/**
 * Return valid Cumulus SNS messages containing granule ingest notifications.
 *
 * @param {Object} event - SNS Notification Event
 * @returns {Array<Object>} granule ingest notification Cumulus messages
 */
function getReportGranuleMessages(event) {
  const records = get(event, 'Records', []);
  return records
    .filter(isSnsEvent)
    .map(getSnsEventMessageObject);
}

/**
 * Lambda handler for report-pdrs Lambda.
 *
 * @param {Object} event - SNS Notification Event
 * @returns {Promise<Array>} granule records
 */
async function handler(event) {
  const messages = getReportGranuleMessages(event);
  return Promise.all(
    messages.map(handleGranuleMessage)
  );
}

module.exports = {
  handler,
  getReportGranuleMessages
};
