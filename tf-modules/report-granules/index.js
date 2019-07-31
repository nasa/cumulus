'use strict';

const get = require('lodash.get');

const {
  isSnsEvent,
  getSnsMessage
} = require('@cumulus/common/sns-event');
const { Granule } = require('@cumulus/api/models');

async function handleGranuleMessage(message) {
  const granuleModel = new Granule();
  return granuleModel.createGranulesFromSns(message);
}

function getReportGranuleMessages(event) {
  const records = get(event, 'Records', []);
  return records
    .filter(isSnsEvent)
    .map(getSnsMessage)
    .filter();
}

async function handler(event) {
  const messages = getReportGranuleMessages(event);
  return Promise.all(
    messages.map(handleGranuleMessage)
  );
}

module.exports = {
  handler
};
