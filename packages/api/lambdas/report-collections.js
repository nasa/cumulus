'use strict';

const get = require('lodash.get');

const {
  isSnsEvent,
  getSnsEventMessageObject
} = require('@cumulus/common/sns-event');
// Temporarily change require while this module resides in the API package
// const Collection = require('@cumulus/api/models/collections');
const Collection = require('../models/collections');

/**
 * Create collection database record.
 *
 * @param {Object} collection - Collection record object
 * @returns {Promise}
 */
async function createCollectionRecord(collection) {
  const collectionModel = new Collection();
  return collectionModel.create(collection);
}

/**
 * Return valid Cumulus SNS messages containing granule ingest notifications.
 *
 * @param {Object} event - SNS Notification Event
 * @returns {Array<Object>} granule ingest notification Cumulus messages
 */
function getReportCollectionMessages(event) {
  const records = get(event, 'Records', []);
  return records
    .filter(isSnsEvent)
    .map(getSnsEventMessageObject);
}

/**
 * Lambda handler for report-collections Lambda.
 *
 * @param {Object} event - SNS Notification Event
 * @returns {Promise<Array>} granule records
 */
async function handler(event) {
  const messages = getReportCollectionMessages(event);
  return Promise.all(
    messages.map(createCollectionRecord)
  );
}

module.exports = {
  handler,
  getReportCollectionMessages
};
