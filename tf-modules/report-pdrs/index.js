'use strict';

const get = require('lodash.get');

const {
  isSnsEvent,
  getSnsEventMessageObject
} = require('@cumulus/common/sns-event');
const Pdr = require('@cumulus/api/models/pdrs');

/**
 * Process Cumulus message object and create PDR database records.
 *
 * @param {Object} message - SNS Cumulus message object
 * @returns {Promise<Array>} PDR records
 */
async function handlePdrMessage(message) {
  const pdrModel = new Pdr();
  return pdrModel.createPdrFromSns(message);
}

/**
 * Return valid Cumulus SNS messages containing PDR ingest notifications.
 *
 * @param {Object} event - SNS Notification Event
 * @returns {Array<Object>} PDR ingest notification Cumulus messages
 */
function getReportPdrMessages(event) {
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
  const messages = getReportPdrMessages(event);
  return Promise.all(
    messages.map(handlePdrMessage)
  );
}

module.exports = {
  handler,
  getReportPdrMessages
};
