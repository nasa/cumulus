'use strict';

const get = require('lodash.get');
const has = require('lodash.has');

const {
  isSnsEvent,
  getSnsEventMessageObject
} = require('@cumulus/common/sns-event');
const Granule = require('@cumulus/api/models/granules');

/**
 * Check if message contains granules.
 * Checks locations expected by sns2elasticsearch
 *
 * @param {Object} message - SNS Cumulus message object
 * @returns {boolean} whether the message contains granules
 */
function containsGranules(message) {
  return (has(message, 'payload.granules') || has(message, 'meta.input_granules'));
}

/**
 * Process Cumulus message object and create granule database records.
 *
 * @param {*} message - SNS Cumulus message object
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
    .map(getSnsEventMessageObject)
    .filter(containsGranules);
}

/**
 * Lambda handler for report-granules Lambda.
 *
 * @param {*} event - SNS Notification Event
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
