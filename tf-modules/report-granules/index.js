'use strict';

const get = require('lodash.get');
const has = require('lodash.has');

const {
  isSnsEvent,
  getSnsEventMessageObject
} = require('@cumulus/common/sns-event');
const Granule = require('@cumulus/api/models/granules');

function containsGranules(message) {
  return (has(message, 'payload.granules') || has(message, 'meta.input_granules'));
}

async function handleGranuleMessage(message) {
  const granuleModel = new Granule();
  return granuleModel.createGranulesFromSns(message);
}

function getReportGranuleMessages(event) {
  const records = get(event, 'Records', []);
  return records
    .filter(isSnsEvent)
    .map(getSnsEventMessageObject)
    .filter(containsGranules);
}

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
