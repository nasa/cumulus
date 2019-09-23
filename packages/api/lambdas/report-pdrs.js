'use strict';

const get = require('lodash.get');

const {
  isSnsEvent,
  getSnsEventMessageObject
} = require('@cumulus/common/sns-event');
// Temporarily change require while this module resides in the API package
// const Pdr = require('@cumulus/api/models/pdrs');
const Pdr = require('../models/pdrs');

/**
 * Create a PDR database record.
 *
 * @param {Object} pdrRecord - A PDR record
 * @returns {Promise}
 */
async function createPdrRecord(pdrRecord) {
  const pdrModel = new Pdr();
  return pdrModel.create(pdrRecord);
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
 * @returns {Promise<Array>} PDR records
 */
async function handler(event) {
  const messages = getReportPdrMessages(event);
  return Promise.all(
    messages.map(createPdrRecord)
  );
}

module.exports = {
  handler,
  getReportPdrMessages
};
