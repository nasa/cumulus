'use strict';

const get = require('lodash.get');

const {
  isSnsEvent,
  getSnsEventMessageObject
} = require('@cumulus/common/sns-event');
// Temporarily change require while this module resides in the API package
// const Granule = require('@cumulus/api/models/granules');
const Granule = require('../models/granules');

/**
 * Create granule database record.
 *
 * @param {Object} granule - Granule record object
 * @returns {Promise}
 */
async function createGranuleRecord(granule) {
  const granuleModel = new Granule();
  return granuleModel.create(granule);
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
 * Lambda handler for report-granules Lambda.
 *
 * @param {Object} event - SNS Notification Event
 * @returns {Promise<Array>} granule records
 */
async function handler(event) {
  const messages = getReportGranuleMessages(event);
  return Promise.all(
    messages.map(createGranuleRecord)
  );
}

module.exports = {
  handler,
  getReportGranuleMessages
};
