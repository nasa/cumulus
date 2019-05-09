'use strict';

const moment = require('moment');
const { generateAndSubmitReports, submitReports } = require('../lib/ems');

/**
 * handler, generate daily report
 *
 * @param {Object} event - event passed to lambda
 * @param {string} event.startTime - test only, report startTime in format YYYY-MM-DDTHH:mm:ss
 * @param {string} event.endTime - test only, report endTime in format YYYY-MM-DDTHH:mm:ss
 * @param {string} event.report - test only, s3 uri of the report to be sent
 * @param {Object} context - AWS Lambda context
 * @param {function} callback - callback function
 * @returns {undefined} undefined
 */
function handler(event, context, callback) {
  // 24-hour period ending past midnight
  let endTime = moment.utc().startOf('day').toDate().toUTCString();
  let startTime = moment.utc().subtract(1, 'days').startOf('day').toDate()
    .toUTCString();

  endTime = event.endTime || endTime;
  startTime = event.startTime || startTime;

  if (event.report) {
    return submitReports([event.report]).then((r) => callback(null, r)).catch(callback);
  }

  return generateAndSubmitReports(startTime, endTime)
    .then((r) => callback(null, r))
    .catch(callback);
}

module.exports = {
  handler
};
