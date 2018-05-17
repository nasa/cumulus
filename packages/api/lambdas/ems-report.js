'use strict';

const moment = require('moment');
const { generateReports } = require('../lib/ems');

/**
 * handler, generate daily report
 *
 * @param {Object} event - event passed to lambda
 * @param {Object} context - AWS Lambda context
 * @param {function} callback - callback function
 * @returns {Promise} - list of report type and its file path {reportType, file}
 */
function handler(event, context, callback) {
  // 24-hour period ending past midnight
  const endTime = moment.utc().startOf('day').toDate().toUTCString();
  const startTime = moment.utc().subtract(1, 'days').startOf('day').toDate()
    .toUTCString();
  return generateReports(startTime, endTime)
    .then((r) => callback(null, r))
    .catch(callback);
}

module.exports = {
  handler
};
